ROOT = "fleet"


def loc(broker_id: str, robot_id: str) -> str:
    return f"{ROOT}/{broker_id}/robots/{robot_id}/loc"


def loc_wildcard(broker_id: str) -> str:
    return f"{ROOT}/{broker_id}/robots/+/loc"


def priority(broker_id: str) -> str:
    return f"{ROOT}/{broker_id}/tasks/priority"


def assignments(broker_id: str) -> str:
    return f"{ROOT}/{broker_id}/tasks/assignments"


def status(broker_id: str) -> str:
    return f"{ROOT}/{broker_id}/status"


def robot_id_from_loc(topic: str) -> str | None:
    parts = topic.split("/")
    return parts[3] if len(parts) >= 5 and parts[2] == "robots" else None
