from core.config import settings

Cell = tuple[float, float]
World = tuple[float, float]


def cell_to_world(col: float, row: float) -> World:
    s = settings.FLEET_CELL_SIZE_M
    return (settings.FLEET_MAP_ORIGIN_X + col * s, settings.FLEET_MAP_ORIGIN_Y + row * s)


def world_to_cell(x_m: float, y_m: float) -> Cell:
    s = settings.FLEET_CELL_SIZE_M or 1.0
    return ((x_m - settings.FLEET_MAP_ORIGIN_X) / s, (y_m - settings.FLEET_MAP_ORIGIN_Y) / s)
