import heapq
import math
from typing import TypeAlias

Grid: TypeAlias = list[list[int]]
Point: TypeAlias = tuple[int, int]


def _heuristic(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _neighbors(grid: Grid, node: Point) -> list[Point]:
    rows, cols = len(grid), len(grid[0])
    x, y = node
    result = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nx, ny = x + dx, y + dy
            if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == 0:
                result.append((nx, ny))
    return result


def _line_of_sight(grid: Grid, a: Point, b: Point) -> bool:
    x0, y0 = a
    x1, y1 = b
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x1 > x0 else -1
    sy = 1 if y1 > y0 else -1
    err = dx - dy
    rows, cols = len(grid), len(grid[0])

    while True:
        if not (0 <= x0 < rows and 0 <= y0 < cols) or grid[x0][y0] != 0:
            return False
        if x0 == x1 and y0 == y1:
            return True
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


def theta_star(
    grid: Grid, start: Point, goal: Point
) -> tuple[list[Point], list[Point], float]:
    open_heap: list[tuple[float, Point]] = []
    heapq.heappush(open_heap, (0.0, start))

    came_from: dict[Point, Point] = {}
    g: dict[Point, float] = {start: 0.0}
    explored: list[Point] = []

    while open_heap:
        _, current = heapq.heappop(open_heap)
        explored.append(current)

        if current == goal:
            path: list[Point] = []
            while current in came_from:
                path.append(current)
                current = came_from[current]
            path.append(start)
            path.reverse()
            return path, explored, g[goal]

        parent = came_from.get(current, current)

        for nb in _neighbors(grid, current):
            if _line_of_sight(grid, parent, nb):
                src = parent
            else:
                src = current

            dx = abs(nb[0] - src[0])
            dy = abs(nb[1] - src[1])
            step_cost = math.hypot(dx, dy)
            tentative = g[src] + step_cost

            if tentative < g.get(nb, float("inf")):
                came_from[nb] = src
                g[nb] = tentative
                f = tentative + _heuristic(nb, goal)
                heapq.heappush(open_heap, (f, nb))

    return [], explored, float("inf")
