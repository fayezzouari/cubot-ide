import math
import random
from typing import TypeAlias

Grid: TypeAlias = list[list[int]]
Point: TypeAlias = tuple[int, int]

_STEP = 4
_RADIUS = 8
_MAX_ITER = 1000
_GOAL_BIAS = 0.15


def _is_free(grid: Grid, x: int, y: int) -> bool:
    rows, cols = len(grid), len(grid[0])
    return 0 <= x < rows and 0 <= y < cols and grid[x][y] == 0


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _steer(src: Point, dst: Point, step: float) -> Point:
    dx, dy = dst[0] - src[0], dst[1] - src[1]
    d = math.hypot(dx, dy)
    if d <= step:
        return dst
    scale = step / d
    return (round(src[0] + dx * scale), round(src[1] + dy * scale))


def _collision_free(grid: Grid, a: Point, b: Point) -> bool:
    dx, dy = b[0] - a[0], b[1] - a[1]
    steps = max(abs(dx), abs(dy))
    if steps == 0:
        return True
    for i in range(steps + 1):
        t = i / steps
        x = round(a[0] + dx * t)
        y = round(a[1] + dy * t)
        if not _is_free(grid, x, y):
            return False
    return True


def rrt_star(
    grid: Grid, start: Point, goal: Point, seed: int = 0
) -> tuple[list[Point], list[Point], float]:
    rng = random.Random(seed)
    rows, cols = len(grid), len(grid[0])

    node_set: set[Point] = {start}
    nodes: list[Point] = [start]
    parent: dict[Point, Point | None] = {start: None}
    cost: dict[Point, float] = {start: 0.0}
    explored: list[Point] = [start]

    for _ in range(_MAX_ITER):
        if rng.random() < _GOAL_BIAS:
            sample = goal
        else:
            sample = (rng.randint(0, rows - 1), rng.randint(0, cols - 1))

        nearest = min(nodes, key=lambda n: _dist(n, sample))
        new_node = _steer(nearest, sample, _STEP)

        if new_node in node_set:
            continue
        if not _is_free(grid, *new_node):
            continue
        if not _collision_free(grid, nearest, new_node):
            continue

        near_nodes = [n for n in nodes if _dist(n, new_node) <= _RADIUS]
        best_parent = nearest
        best_cost = cost[nearest] + _dist(nearest, new_node)

        for near in near_nodes:
            c = cost[near] + _dist(near, new_node)
            if c < best_cost and _collision_free(grid, near, new_node):
                best_cost = c
                best_parent = near

        node_set.add(new_node)
        nodes.append(new_node)
        parent[new_node] = best_parent
        cost[new_node] = best_cost
        explored.append(new_node)

        for near in near_nodes:
            rewired = cost[new_node] + _dist(new_node, near)
            if rewired < cost.get(near, float("inf")) and _collision_free(grid, new_node, near):
                parent[near] = new_node
                cost[near] = rewired

        if _dist(new_node, goal) <= _STEP and _collision_free(grid, new_node, goal):
            g_cost = cost[new_node] + _dist(new_node, goal)
            if g_cost < cost.get(goal, float("inf")):
                parent[goal] = new_node
                cost[goal] = g_cost
                if goal not in node_set:
                    node_set.add(goal)
                    nodes.append(goal)

    if goal not in parent:
        return [], explored, float("inf")

    path: list[Point] = []
    cur: Point | None = goal
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    path.reverse()
    return path, explored, cost[goal]
