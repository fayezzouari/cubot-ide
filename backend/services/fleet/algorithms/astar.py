import heapq
from typing import TypeAlias

Grid: TypeAlias = list[list[int]]
Point: TypeAlias = tuple[int, int]


def _heuristic(a: Point, b: Point) -> float:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def _neighbors(grid: Grid, node: Point) -> list[Point]:
    rows, cols = len(grid), len(grid[0])
    x, y = node
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1)]
    result = []
    for dx, dy in dirs:
        nx, ny = x + dx, y + dy
        if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == 0:
            result.append((nx, ny))
    return result


def astar(
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

        for nb in _neighbors(grid, current):
            dx = abs(nb[0] - current[0])
            dy = abs(nb[1] - current[1])
            step = 1.414 if dx + dy == 2 else 1.0
            tentative = g[current] + step
            if tentative < g.get(nb, float("inf")):
                came_from[nb] = current
                g[nb] = tentative
                f = tentative + _heuristic(nb, goal)
                heapq.heappush(open_heap, (f, nb))

    return [], explored, float("inf")
