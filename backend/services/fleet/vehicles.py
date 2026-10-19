from core.config import settings
from schemas.fleet.drone import DroneOut
from schemas.fleet.robot import RobotOut
from services.fleet import db


def robot_out(doc: dict) -> RobotOut:
    out = db.to_out(doc)
    out.setdefault("serial_number", out["id"])
    out.setdefault("manufacturer", settings.FLEET_MANUFACTURER)
    return RobotOut(**out)


def drone_out(doc: dict) -> DroneOut:
    out = db.to_out(doc)
    out.setdefault("serial_number", out["id"])
    out.setdefault("manufacturer", settings.FLEET_MANUFACTURER)
    return DroneOut(**out)
