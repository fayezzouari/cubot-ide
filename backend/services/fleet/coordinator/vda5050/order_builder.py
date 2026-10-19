from dataclasses import dataclass, field

from services.fleet.coordinator.vda5050 import geometry, protocol
from services.fleet.coordinator.vda5050.messages import Action, Edge, Node, NodePosition, Order
from services.fleet.coordinator.vda5050.pathing import Grid, astar_path

Cell = tuple[int, int]


@dataclass
class NodeSpec:
    cell: Cell
    actions: list[Action] = field(default_factory=list)
    task_id: str | None = None


def task_action(task: dict) -> Action:
    atype = task.get("action_type") or "pick"
    return Action(
        actionId=f"{task['id']}-{atype}",
        actionType=atype,
        blockingType=protocol.BlockingType.HARD,
        actionParameters=[{"key": "taskId", "value": str(task["id"])}],
    )


def _collinear(a: Cell, b: Cell, c: Cell) -> bool:
    return (b[0] - a[0]) * (c[1] - a[1]) == (b[1] - a[1]) * (c[0] - a[0])


def build_route(grid: Grid, start: Cell, tasks: list[dict]) -> list[NodeSpec]:
    specs: list[NodeSpec] = [NodeSpec(cell=start)]
    cur = start
    for task in tasks:
        goal = task["cell"]
        seg = astar_path(grid, cur, goal) or [cur, goal]
        for c in seg[1:-1]:
            specs.append(NodeSpec(cell=c))
        specs.append(NodeSpec(cell=seg[-1], actions=[task_action(task)], task_id=str(task["id"])))
        cur = seg[-1]
    return _simplify(specs)


def _simplify(specs: list[NodeSpec]) -> list[NodeSpec]:
    if len(specs) <= 2:
        return specs
    out = [specs[0]]
    for prev, node, nxt in zip(specs, specs[1:], specs[2:]):
        if node.actions or not _collinear(out[-1].cell, node.cell, nxt.cell):
            out.append(node)
    out.append(specs[-1])
    return out


def assemble(
    *,
    specs: list[NodeSpec],
    released_upto: int,
    order_id: str,
    order_update_id: int,
    map_id: str,
    version: str,
    manufacturer: str,
    serial: str,
    header_id: int,
) -> Order:
    nodes: list[Node] = []
    for i, spec in enumerate(specs):
        x, y = geometry.cell_to_world(spec.cell[0], spec.cell[1])
        nodes.append(Node(
            nodeId=f"n{i}-{spec.cell[0]}-{spec.cell[1]}",
            sequenceId=2 * i,
            released=i <= released_upto,
            nodePosition=NodePosition(x=x, y=y, mapId=map_id),
            actions=spec.actions,
        ))

    edges: list[Edge] = []
    for i in range(len(nodes) - 1):
        end_released = (i + 1) <= released_upto
        edges.append(Edge(
            edgeId=f"e{i}",
            sequenceId=2 * i + 1,
            released=end_released,
            startNodeId=nodes[i].nodeId,
            endNodeId=nodes[i + 1].nodeId,
        ))

    return Order(
        headerId=header_id,
        version=version,
        manufacturer=manufacturer,
        serialNumber=serial,
        orderId=order_id,
        orderUpdateId=order_update_id,
        nodes=nodes,
        edges=edges,
    )
