from core.database import get_collection

ROBOTS = "fleet_robots"
DRONES = "fleet_drones"
TASKS = "fleet_tasks"
CATEGORIES = "fleet_categories"
ENVIRONMENTS = "fleet_environments"
BROKERS = "fleet_brokers"

FLEET_COLLECTIONS = (ROBOTS, DRONES, TASKS, CATEGORIES, ENVIRONMENTS, BROKERS)


def projects():
    return get_collection("projects")


def robots():
    return get_collection(ROBOTS)


def drones():
    return get_collection(DRONES)


def tasks():
    return get_collection(TASKS)


def categories():
    return get_collection(CATEGORIES)


def environments():
    return get_collection(ENVIRONMENTS)


def brokers():
    return get_collection(BROKERS)


def to_out(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    return out


async def delete_project_data(project_id: str) -> None:
    for name in FLEET_COLLECTIONS:
        await get_collection(name).delete_many({"project_id": project_id})
