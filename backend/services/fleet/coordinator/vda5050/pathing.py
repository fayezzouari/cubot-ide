import heapq

Grid = list[list[int]]
Cell = tuple[int, int]

_DIRS = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def _clamp(grid: Grid, col: float, row: float) -> Cell:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    c = min(max(int(round(col)), 0), max(0, cols - 1))
    r = min(max(int(round(row)), 0), max(0, rows - 1))
    return (c, r)


def astar_path(grid: Grid, start: Cell, goal: Cell) -> list[Cell] | None:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    if not rows or not cols:
        return None
    sc, sr = start
    gc, gr = goal
    if not (0 <= gr < rows and 0 <= gc < cols) or grid[gr][gc] == 1:
        return None

    s = (sr, sc)
    g = (gr, gc)
    open_heap: list[tuple[float, tuple[int, int]]] = [(0.0, s)]
    came: dict[tuple[int, int], tuple[int, int]] = {}
    cost: dict[tuple[int, int], float] = {s: 0.0}
    while open_heap:
        _, cur = heapq.heappop(open_heap)
        if cur == g:
            return _reconstruct(came, cur)
        cr, cc = cur
        for dr, dc in _DIRS:
            nr, nc = cr + dr, cc + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0:
                step = 1.414 if dr and dc else 1.0
                t = cost[cur] + step
                if t < cost.get((nr, nc), float("inf")):
                    cost[(nr, nc)] = t
                    came[(nr, nc)] = cur
                    h = abs(nr - gr) + abs(nc - gc)
                    heapq.heappush(open_heap, (t + h, (nr, nc)))
    return None


def _reconstruct(came: dict, cur: tuple[int, int]) -> list[Cell]:
    out = [cur]
    while cur in came:
        cur = came[cur]
        out.append(cur)
    out.reverse()
    return [(c, r) for (r, c) in out]


def path_cost(path: list[Cell]) -> float:
    total = 0.0
    for (c0, r0), (c1, r1) in zip(path, path[1:]):
        total += 1.414 if (c0 != c1 and r0 != r1) else 1.0
    return total


def clamp_cell(grid: Grid, col: float, row: float) -> Cell:
    return _clamp(grid, col, row)
