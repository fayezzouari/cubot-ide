import math
import random
from typing import TypeAlias

Grid: TypeAlias = list[list[int]]
Point: TypeAlias = tuple[int, int]

_STEP = 4
_MAX_ITER = 800
_GOAL_BIAS = 0.15


def _is_free(grid: Grid, x: int, y: int) -> bool:
    rows, cols = len(grid), len(grid[0])
    return 0 <= x < rows and 0 <= y < cols and grid[x][y] == 0


def _steer(src: Point, dst: Point, step: float) -> Point:
    dx, dy = dst[0] - src[0], dst[1] - src[1]
    dist = math.hypot(dx, dy)
    if dist <= step:
        return dst
    scale = step / dist
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


def _nearest(nodes: list[Point], target: Point) -> Point:
    return min(nodes, key=lambda n: (n[0] - target[0]) ** 2 + (n[1] - target[1]) ** 2)


def rrt(
    grid: Grid, start: Point, goal: Point, seed: int = 0
) -> tuple[list[Point], list[Point], float]:
    rng = random.Random(seed)
    rows, cols = len(grid), len(grid[0])

    nodes: list[Point] = [start]
    seen: set[Point] = {start}
    parent: dict[Point, Point] = {}
    explored: list[Point] = [start]

    for _ in range(_MAX_ITER):
        if rng.random() < _GOAL_BIAS:
            sample = goal
        else:
            sample = (rng.randint(0, rows - 1), rng.randint(0, cols - 1))

        nearest = _nearest(nodes, sample)
        new_node = _steer(nearest, sample, _STEP)

        if new_node in seen or not _is_free(grid, *new_node):
            continue
        if not _collision_free(grid, nearest, new_node):
            continue

        nodes.append(new_node)
        seen.add(new_node)
        parent[new_node] = nearest
        explored.append(new_node)

        if math.hypot(new_node[0] - goal[0], new_node[1] - goal[1]) <= _STEP:
            if _collision_free(grid, new_node, goal):
                if new_node != goal:
                    parent[goal] = new_node
                path: list[Point] = []
                cur = goal
                while cur in parent:
                    path.append(cur)
                    cur = parent[cur]
                path.append(start)
                path.reverse()
                cost = sum(
                    math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
                    for i in range(len(path) - 1)
                )
                return path, explored, cost

    return [], explored, float("inf")
