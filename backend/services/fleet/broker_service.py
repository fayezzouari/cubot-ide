from datetime import datetime, timezone

from fastapi import HTTPException, status

from core.config import settings
from schemas.fleet.broker import (
    DEFAULT_BROKER_MODE,
    DEFAULT_BROKER_NAME,
    BrokerCreate,
    BrokerOut,
    BrokerUpdate,
)
from services.fleet import db
from services.fleet.coordinator.topics import ROOT
from services.fleet.ownership import get_owned_doc


def _out(doc: dict) -> BrokerOut:
    bid = str(doc["_id"])
    return BrokerOut(
        id=bid,
        project_id=doc["project_id"],
        name=doc.get("name", DEFAULT_BROKER_NAME),
        status=doc.get("status", "running"),
        mode=doc.get("mode", DEFAULT_BROKER_MODE),
        dispatch_active=doc.get("dispatch_active", True),
        auto_assign=doc.get("auto_assign", True),
        topic_prefix=f"{ROOT}/{bid}",
        ws_url=settings.FLEET_MQTT_WS_URL,
        mqtt_host=settings.FLEET_MQTT_PUBLIC_HOST,
        mqtt_port=settings.FLEET_MQTT_PUBLIC_PORT,
        manufacturer=settings.FLEET_MANUFACTURER,
        created_at=doc["created_at"],
    )


async def ensure_broker(project_id: str, user_id: str, name: str = DEFAULT_BROKER_NAME) -> BrokerOut:
    existing = await db.brokers().find_one({"project_id": project_id})
    if existing:
        return _out(existing)
    doc = {
        "project_id": project_id,
        "user_id": user_id,
        "name": name,
        "status": "running",
        "mode": DEFAULT_BROKER_MODE,
        "dispatch_active": True,
        "auto_assign": True,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.brokers().insert_one(doc)
    doc["_id"] = res.inserted_id
    return _out(doc)


async def get_broker(project_id: str, user_id: str) -> BrokerOut:
    await get_owned_doc(project_id, user_id)
    doc = await db.brokers().find_one({"project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No broker for this project")
    return _out(doc)


async def create_broker(project_id: str, user_id: str, body: BrokerCreate) -> BrokerOut:
    await get_owned_doc(project_id, user_id)
    return await ensure_broker(project_id, user_id, body.name)


async def update_broker(project_id: str, user_id: str, body: BrokerUpdate) -> BrokerOut:
    await get_owned_doc(project_id, user_id)
    doc = await db.brokers().find_one({"project_id": project_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No broker for this project")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if changes.get("mode") == "live" and doc.get("mode") != "live":
        changes.setdefault("dispatch_active", False)
    if changes:
        await db.brokers().update_one({"project_id": project_id}, {"$set": changes})
        doc.update(changes)
    return _out(doc)


async def delete_broker(project_id: str, user_id: str) -> None:
    await get_owned_doc(project_id, user_id)
    await db.brokers().delete_one({"project_id": project_id})
