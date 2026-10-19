from services.fleet.coordinator.vda5050 import geometry, order_builder
from services.fleet.coordinator.vda5050.messages import Order
from services.fleet.coordinator.vda5050.pathing import astar_path
from services.fleet.coordinator.vda5050.stitching import OrderStore

grid = [[0] * 6 for _ in range(6)]
for r in range(4):
    grid[r][3] = 1

assert geometry.cell_to_world(2, 3) == (2.0, 3.0)
col, row = geometry.world_to_cell(2.0, 3.0)
assert (round(col), round(row)) == (2, 3)

path = astar_path(grid, (0, 0), (5, 0))
assert path and path[0] == (0, 0) and path[-1] == (5, 0)
assert all(grid[r][c] == 0 for (c, r) in path), "path must avoid obstacles"

tasks = [
    {"id": "t1", "cell": (5, 0), "action_type": "pick"},
    {"id": "t2", "cell": (5, 5), "action_type": "drop"},
]
specs = order_builder.build_route(grid, start=(0, 0), tasks=tasks)
assert specs[0].cell == (0, 0)
action_nodes = [s for s in specs if s.actions]
assert [s.task_id for s in action_nodes] == ["t1", "t2"]
assert action_nodes[0].actions[0].actionType == "pick"
assert action_nodes[1].actions[0].actionType == "drop"

store = OrderStore()
seq = tuple(str(t["id"]) for t in tasks)
o0 = store.open_order("AMR-1", seq, specs, released_upto=2)
assert o0.order_update_id == 0 and o0.order_id == "AMR-1-1"

assert store.release("AMR-1", 2) is None, "no change -> no republish"
o1 = store.release("AMR-1", 4)
assert o1 and o1.order_update_id == 1 and o1.released_upto == 4
assert store.release("AMR-1", 3) is None, "window never retreats"

o2 = store.open_order("AMR-1", ("t2",), specs, released_upto=1)
assert o2.order_id == "AMR-1-2" and o2.order_update_id == 0

msg = order_builder.assemble(
    specs=specs, released_upto=2, order_id="AMR-1-1", order_update_id=0,
    map_id="proj42", version="2.0.0", manufacturer="cubot",
    serial="AMR-1", header_id=1,
)
dumped = msg.model_dump_json(exclude_none=True)
round_trip = Order.model_validate_json(dumped)
assert round_trip.orderId == "AMR-1-1"
assert [n.released for n in round_trip.nodes[:3]] == [True, True, True]
assert round_trip.nodes[3].released is False
seqs = []
for n in round_trip.nodes:
    seqs.append(n.sequenceId)
assert seqs == sorted(seqs) and all(s % 2 == 0 for s in seqs)
assert all(e.sequenceId % 2 == 1 for e in round_trip.edges)
assert len(round_trip.edges) == len(round_trip.nodes) - 1
assert any(a.actionType == "pick" for n in round_trip.nodes for a in n.actions)

print("LOGIC_OK  nodes=%d edges=%d" % (len(round_trip.nodes), len(round_trip.edges)))
