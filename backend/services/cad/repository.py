"""
MongoDB documents for CAD Studio.

  cad_parts          {_id, project_id, owner, name, source, kind, color, current_version, created_at, updated_at}
  cad_part_versions  {_id, part_id, project_id, number, code, params, assets, prompt, parent, key, meta, created_at}
  cad_assemblies     {_id: project_id, owner, name, instances: [...], updated_at}

`source` is how the part started (generated / imported); every change makes
a new version, so the history of a part is its version chain.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.database import get_collection

PARTS = "cad_parts"
VERSIONS = "cad_part_versions"
ASSEMBLIES = "cad_assemblies"


def _now():
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


async def ensure_indexes():
    await get_collection(PARTS).create_index([("project_id", 1)])
    await get_collection(VERSIONS).create_index([("part_id", 1), ("number", -1)])


async def list_parts(project_id: str) -> list[dict]:
    return await get_collection(PARTS).find({"project_id": project_id}).sort("created_at", 1).to_list(None)


async def get_part(project_id: str, part_id: str) -> Optional[dict]:
    return await get_collection(PARTS).find_one({"_id": part_id, "project_id": project_id})


async def create_part(project_id: str, owner: Optional[str], name: str, source: str, kind: str,
                      color: str) -> dict:
    doc = {
        "_id": new_id(),
        "project_id": project_id,
        "owner": owner,
        "name": name,
        "source": source,
        "kind": kind,
        "color": color,
        "current_version": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await get_collection(PARTS).insert_one(doc)
    return doc


async def update_part(part_id: str, fields: dict) -> None:
    await get_collection(PARTS).update_one({"_id": part_id}, {"$set": {**fields, "updated_at": _now()}})


async def delete_part(project_id: str, part_id: str) -> None:
    await get_collection(PARTS).delete_one({"_id": part_id, "project_id": project_id})
    await get_collection(VERSIONS).delete_many({"part_id": part_id})


async def add_version(part: dict, code: str, params: dict, assets: dict, prompt: Optional[str],
                      key: str, meta: dict) -> dict:
    last = await get_collection(VERSIONS).find_one({"part_id": part["_id"]}, sort=[("number", -1)])
    doc = {
        "_id": new_id(),
        "part_id": part["_id"],
        "project_id": part["project_id"],
        "number": (last["number"] + 1) if last else 1,
        "code": code,
        "params": params,
        "assets": assets,
        "prompt": prompt,
        "parent": part.get("current_version"),
        "key": key,
        "meta": meta,
        "created_at": _now(),
    }
    await get_collection(VERSIONS).insert_one(doc)
    await update_part(part["_id"], {"current_version": doc["_id"]})
    part["current_version"] = doc["_id"]
    return doc


async def get_version(part_id: str, version_id: str) -> Optional[dict]:
    return await get_collection(VERSIONS).find_one({"_id": version_id, "part_id": part_id})


async def get_versions(version_ids: list[str]) -> dict[str, dict]:
    docs = await get_collection(VERSIONS).find({"_id": {"$in": version_ids}}).to_list(None)
    return {d["_id"]: d for d in docs}


async def list_versions(part_id: str) -> list[dict]:
    return await get_collection(VERSIONS).find(
        {"part_id": part_id}, {"code": 0, "meta.params": 0}
    ).sort("number", -1).to_list(200)


async def get_assembly(project_id: str) -> dict:
    doc = await get_collection(ASSEMBLIES).find_one({"_id": project_id})
    return doc or {"_id": project_id, "name": "Assembly", "instances": []}


async def save_assembly(project_id: str, owner: Optional[str], name: Optional[str], instances: list[dict]) -> dict:
    fields = {"owner": owner, "instances": instances, "updated_at": _now()}
    if name:
        fields["name"] = name
    await get_collection(ASSEMBLIES).update_one({"_id": project_id}, {"$set": fields}, upsert=True)
    return await get_assembly(project_id)


async def add_instances(project_id: str, owner: Optional[str], instances: list[dict]) -> None:
    await get_collection(ASSEMBLIES).update_one(
        {"_id": project_id},
        {"$push": {"instances": {"$each": instances}},
         "$set": {"owner": owner, "updated_at": _now()},
         "$setOnInsert": {"name": "Assembly"}},
        upsert=True,
    )


async def name_assembly_if_unnamed(project_id: str, owner: Optional[str], name: str) -> None:
    await get_collection(ASSEMBLIES).update_one(
        {"_id": project_id, "$or": [{"name": "Assembly"}, {"name": {"$exists": False}}]},
        {"$set": {"name": name[:120], "owner": owner, "updated_at": _now()}},
    )
    if not await get_collection(ASSEMBLIES).find_one({"_id": project_id}):
        await get_collection(ASSEMBLIES).insert_one(
            {"_id": project_id, "name": name[:120], "owner": owner, "instances": [], "updated_at": _now()})


async def remove_part_instances(project_id: str, part_id: str) -> None:
    await get_collection(ASSEMBLIES).update_one(
        {"_id": project_id}, {"$pull": {"instances": {"part_id": part_id}}}
    )


async def legacy_session_code(project_id: str) -> Optional[str]:
    """Code saved by the previous CAD chat for this project, if any."""
    doc = await get_collection("cad_sessions").find_one({"session_id": project_id})
    return (doc or {}).get("current_code")
