import heapq
from typing import TypeAlias

Grid: TypeAlias = list[list[int]]
Point: TypeAlias = tuple[int, int]


def _neighbors(grid: Grid, node: Point) -> list[tuple[Point, float]]:
    rows, cols = len(grid), len(grid[0])
    x, y = node
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1)]
    result = []
    for dx, dy in dirs:
        nx, ny = x + dx, y + dy
        if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == 0:
            cost = 1.414 if abs(dx) + abs(dy) == 2 else 1.0
            result.append(((nx, ny), cost))
    return result


def dijkstra(
    grid: Grid, start: Point, goal: Point
) -> tuple[list[Point], list[Point], float]:
    open_heap: list[tuple[float, Point]] = []
    heapq.heappush(open_heap, (0.0, start))

    came_from: dict[Point, Point] = {}
    dist: dict[Point, float] = {start: 0.0}
    explored: list[Point] = []

    while open_heap:
        d, current = heapq.heappop(open_heap)
        if d > dist.get(current, float("inf")):
            continue
        explored.append(current)

        if current == goal:
            path: list[Point] = []
            while current in came_from:
                path.append(current)
                current = came_from[current]
            path.append(start)
            path.reverse()
            return path, explored, dist[goal]

        for nb, cost in _neighbors(grid, current):
            tentative = dist[current] + cost
            if tentative < dist.get(nb, float("inf")):
                came_from[nb] = current
                dist[nb] = tentative
                heapq.heappush(open_heap, (tentative, nb))

    return [], explored, float("inf")
