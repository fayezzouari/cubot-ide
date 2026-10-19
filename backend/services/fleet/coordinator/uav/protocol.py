ORDER = "order"
INSTANT_ACTIONS = "instantActions"
STATE = "state"
VISUALIZATION = "visualization"
CONNECTION = "connection"

MASTER_TO_VEHICLE = (ORDER, INSTANT_ACTIONS)
VEHICLE_TO_MASTER = (STATE, VISUALIZATION, CONNECTION)


class ConnectionState:
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    CONNECTIONBROKEN = "CONNECTIONBROKEN"


class BlockingType:
    NONE = "NONE"
    SOFT = "SOFT"
    HARD = "HARD"


class ActionStatus:
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    FAILED = "FAILED"


class FlightStatus:
    IDLE = "IDLE"
    TAKEOFF = "TAKEOFF"
    CRUISE = "CRUISE"
    LANDING = "LANDING"
    HOVER = "HOVER"
    LANDED = "LANDED"


CANCEL_ORDER = "cancelOrder"
