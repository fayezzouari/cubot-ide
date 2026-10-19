import heapq

Grid = list[list[int]]
Cell3D = tuple[int, int, int]

_DIRS3D = [
    (dx, dy, dz)
    for dx in (-1, 0, 1)
    for dy in (-1, 0, 1)
    for dz in (-1, 0, 1)
    if (dx, dy, dz) != (0, 0, 0)
]


def _clamp(grid: Grid, depth: int, col: float, row: float, z: float) -> Cell3D:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    c = min(max(int(round(col)), 0), max(0, cols - 1))
    r = min(max(int(round(row)), 0), max(0, rows - 1))
    zz = min(max(int(round(z)), 0), max(0, depth - 1))
    return (c, r, zz)


def astar3d_path(
    grid: Grid, depth: int, start: Cell3D, goal: Cell3D
) -> list[Cell3D] | None:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    if not rows or not cols or depth < 1:
        return None
    sc, sr, sz = start
    gc, gr, gz = goal
    if not (0 <= gr < rows and 0 <= gc < cols and 0 <= gz < depth) or grid[gr][gc] == 1:
        return None

    open_heap: list[tuple[float, Cell3D]] = [(0.0, start)]
    came: dict[Cell3D, Cell3D] = {}
    cost: dict[Cell3D, float] = {start: 0.0}
    while open_heap:
        _, cur = heapq.heappop(open_heap)
        if cur == goal:
            return _reconstruct(came, cur)
        cc, cr, cz = cur
        for dx, dy, dz in _DIRS3D:
            nc, nr, nz = cc + dx, cr + dy, cz + dz
            if 0 <= nr < rows and 0 <= nc < cols and 0 <= nz < depth and grid[nr][nc] == 0:
                moved = abs(dx) + abs(dy) + abs(dz)
                step = {1: 1.0, 2: 1.414, 3: 1.732}[moved]
                t = cost[cur] + step
                nb = (nc, nr, nz)
                if t < cost.get(nb, float("inf")):
                    cost[nb] = t
                    came[nb] = cur
                    h = abs(nr - gr) + abs(nc - gc) + abs(nz - gz)
                    heapq.heappush(open_heap, (t + h, nb))
    return None


def _reconstruct(came: dict, cur: Cell3D) -> list[Cell3D]:
    out = [cur]
    while cur in came:
        cur = came[cur]
        out.append(cur)
    out.reverse()
    return out


def clamp_cell(grid: Grid, depth: int, col: float, row: float, z: float) -> Cell3D:
    return _clamp(grid, depth, col, row, z)
