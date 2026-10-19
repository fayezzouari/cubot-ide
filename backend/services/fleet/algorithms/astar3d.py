import heapq
from typing import TypeAlias

Grid3D: TypeAlias = list[list[list[int]]]
Point3D: TypeAlias = tuple[int, int, int]


def _heuristic(a: Point3D, b: Point3D) -> float:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def _neighbors(grid: Grid3D, node: Point3D) -> list[Point3D]:
    depth = len(grid)
    rows = len(grid[0]) if depth else 0
    cols = len(grid[0][0]) if rows else 0
    z, x, y = node
    result = []
    for dz in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dz == 0 and dx == 0 and dy == 0:
                    continue
                nz, nx, ny = z + dz, x + dx, y + dy
                if 0 <= nz < depth and 0 <= nx < rows and 0 <= ny < cols and grid[nz][nx][ny] == 0:
                    result.append((nz, nx, ny))
    return result


def astar3d(
    grid: Grid3D, start: Point3D, goal: Point3D
) -> tuple[list[Point3D], list[Point3D], float]:
    open_heap: list[tuple[float, Point3D]] = []
    heapq.heappush(open_heap, (0.0, start))

    came_from: dict[Point3D, Point3D] = {}
    g: dict[Point3D, float] = {start: 0.0}
    explored: list[Point3D] = []

    while open_heap:
        _, current = heapq.heappop(open_heap)
        explored.append(current)

        if current == goal:
            path: list[Point3D] = []
            while current in came_from:
                path.append(current)
                current = came_from[current]
            path.append(start)
            path.reverse()
            return path, explored, g[goal]

        for nb in _neighbors(grid, current):
            dz = abs(nb[0] - current[0])
            dx = abs(nb[1] - current[1])
            dy = abs(nb[2] - current[2])
            moved = dz + dx + dy
            step = {1: 1.0, 2: 1.414, 3: 1.732}[moved]
            tentative = g[current] + step
            if tentative < g.get(nb, float("inf")):
                came_from[nb] = current
                g[nb] = tentative
                f = tentative + _heuristic(nb, goal)
                heapq.heappush(open_heap, (f, nb))

    return [], explored, float("inf")
