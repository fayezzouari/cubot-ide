from math import hypot

from core.config import settings
from schemas.fleet.common import Vec3
from schemas.fleet.planning import (
    Algorithm,
    DronePlanRequest,
    DronePlanResponse,
    PlanRequest,
    PlanResponse,
    PlanRoutesRequest,
    PlanRoutesResponse,
    Point,
    Point3D,
    RobotRoute,
    RouteCheckpoint,
    RoutePoint,
    RouteTask,
)
from services.fleet.algorithms import astar, dijkstra, rrt, rrt_star, theta_star
from services.fleet.algorithms.astar3d import astar3d

_ALGORITHMS = {
    Algorithm.astar: astar,
    Algorithm.dijkstra: dijkstra,
    Algorithm.rrt: rrt,
    Algorithm.rrt_star: rrt_star,
    Algorithm.theta_star: theta_star,
}

Grid = list[list[int]]
Cell = tuple[int, int]
XY = tuple[float, float]


def run_plan(req: PlanRequest) -> PlanResponse:
    grid = req.grid
    start = (req.start.x, req.start.y)
    goal = (req.goal.x, req.goal.y)

    dispatch = {
        Algorithm.astar: lambda: astar(grid, start, goal),
        Algorithm.dijkstra: lambda: dijkstra(grid, start, goal),
        Algorithm.rrt: lambda: rrt(grid, start, goal),
        Algorithm.rrt_star: lambda: rrt_star(grid, start, goal),
        Algorithm.theta_star: lambda: theta_star(grid, start, goal),
    }

    path_raw, explored_raw, cost = dispatch[req.algorithm]()

    step = max(1, len(explored_raw) // 400)
    sampled_explored = explored_raw[::step]

    return PlanResponse(
        path=[Point(x=p[0], y=p[1]) for p in path_raw],
        explored=[Point(x=e[0], y=e[1]) for e in sampled_explored],
        algorithm=req.algorithm,
        cost=cost,
    )


def _cell_key(p: XY) -> str:
    return f"{round(p[0])},{round(p[1])}"


def _dist(a: XY, b: XY) -> float:
    return hypot(a[0] - b[0], a[1] - b[1])


def _xy(pos: Vec3) -> XY:
    return (pos.x, pos.y)


def _clamp(p: XY, width: int, height: int) -> Cell:
    col = min(max(round(p[0]), 0), max(0, width - 1))
    row = min(max(round(p[1]), 0), max(0, height - 1))
    return (col, row)


def _inflate(obstacles: Grid, keep: list[Cell]) -> Grid:
    h = len(obstacles)
    w = len(obstacles[0]) if h else 0
    if not h or not w:
        return [row[:] for row in obstacles]
    out = [row[:] for row in obstacles]
    k = settings.FLEET_ROBOT_CLEARANCE_CELLS
    for r in range(h):
        for c in range(w):
            if obstacles[r][c] != 1:
                continue
            for dr in range(-k, k + 1):
                for dc in range(-k, k + 1):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < h and 0 <= nc < w:
                        out[nr][nc] = 1
    for col, row in keep:
        if 0 <= row < h and 0 <= col < w:
            out[row][col] = 0
    return out


def _search(grid: Grid, s: Cell, g: Cell, algorithm: Algorithm) -> list[XY] | None:
    try:
        path, _explored, _cost = _ALGORITHMS[algorithm](grid, (s[1], s[0]), (g[1], g[0]))
        if len(path) > 1:
            return [(float(node[1]), float(node[0])) for node in path]
    except Exception:
        pass
    return None


def _plan_segment(
    obstacles: Grid,
    width: int,
    height: int,
    frm: XY,
    to: XY,
    algorithm: Algorithm,
    reserved: set[str],
) -> list[XY]:
    s = _clamp(frm, width, height)
    g = _clamp(to, width, height)
    base = _inflate(obstacles, [s, g])
    gh = len(base)
    gw = len(base[0]) if gh else 0

    grid = [row[:] for row in base]
    for key in reserved:
        cx, cy = key.split(",")
        col, row = int(cx), int(cy)
        if 0 <= row < gh and 0 <= col < gw:
            grid[row][col] = 1
    grid[s[1]][s[0]] = 0
    grid[g[1]][g[0]] = 0

    return (
        _search(grid, s, g, algorithm)
        or _search(base, s, g, algorithm)
        or [(float(s[0]), float(s[1])), (float(g[0]), float(g[1]))]
    )


def plan_routes(req: PlanRoutesRequest) -> PlanRoutesResponse:
    obstacles = req.obstacles
    width = req.width
    height = req.height

    open_tasks: dict[str, list[RouteTask]] = {
        r.id: [t for t in req.tasks if t.assigned_robot_id == r.id and t.status != "done"] for r in req.robots
    }

    reserved: set[str] = {_cell_key(_xy(r.position)) for r in req.robots}

    order = sorted(req.robots, key=lambda r: (0 if open_tasks[r.id] else 1, r.id))

    routes: list[RobotRoute] = []
    for robot in order:
        start = _xy(robot.position)
        mine = open_tasks[robot.id]

        if not mine:
            routes.append(
                RobotRoute(
                    robot_id=robot.id,
                    points=[RoutePoint(x=start[0], y=start[1])],
                    checkpoints=[],
                )
            )
            continue

        remaining = list(mine)
        cursor = start
        ordered: list[RouteTask] = []
        while remaining:
            remaining.sort(key=lambda t: (-t.priority, _dist(cursor, _xy(t.position))))
            nxt = remaining.pop(0)
            ordered.append(nxt)
            cursor = _xy(nxt.position)

        points: list[XY] = [start]
        checkpoints: list[RouteCheckpoint] = []
        cur = start
        for task in ordered:
            seg = _plan_segment(obstacles, width, height, cur, _xy(task.position), req.algorithm, reserved)
            points.extend(seg[1:])
            checkpoints.append(RouteCheckpoint(index=len(points) - 1, task_id=task.id))
            cur = points[-1]

        routes.append(
            RobotRoute(
                robot_id=robot.id,
                points=[RoutePoint(x=p[0], y=p[1]) for p in points],
                checkpoints=checkpoints,
            )
        )
        for p in points:
            reserved.add(_cell_key(p))

    return PlanRoutesResponse(routes=routes)


def _extrude(obstacles: Grid, depth: int) -> list[Grid]:
    return [[row[:] for row in obstacles] for _ in range(depth)]


def run_drone_plan(req: DronePlanRequest) -> DronePlanResponse:
    grid3d = _extrude(req.obstacles, req.depth)
    start = (req.start.z, req.start.y, req.start.x)
    goal = (req.goal.z, req.goal.y, req.goal.x)

    path_raw, explored_raw, cost = astar3d(grid3d, start, goal)

    step = max(1, len(explored_raw) // 400)
    sampled_explored = explored_raw[::step]

    return DronePlanResponse(
        path=[Point3D(x=p[2], y=p[1], z=p[0]) for p in path_raw],
        explored=[Point3D(x=e[2], y=e[1], z=e[0]) for e in sampled_explored],
        cost=cost,
    )
