from collections.abc import Callable
from math import hypot

from services.fleet.coordinator.vda5050.pathing import astar_path, clamp_cell, path_cost

Pos = tuple[float, float, float]


def make_eta(grid: list[list[int]]) -> Callable[[Pos, Pos, float], float]:
    rows = len(grid) if grid else 0
    cols = len(grid[0]) if rows else 0

    def eta(a: Pos, b: Pos, speed: float) -> float:
        spd = max(0.5, speed)
        straight = hypot(a[0] - b[0], a[1] - b[1]) / spd
        if not rows or not cols:
            return straight
        s = clamp_cell(grid, a[0], a[1])
        g = clamp_cell(grid, b[0], b[1])
        path = astar_path(grid, s, g)
        if not path:
            return straight
        return path_cost(path) / spd

    return eta
