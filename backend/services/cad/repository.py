"""
MongoDB documents for CAD Studio.

  cad_parts          {_id, project_id, owner, name, source, kind, color, current_version, created_at, updated_at}
  cad_part_versions  {_id, part_id, project_id, number, code, params, assets, prompt, parent, key, meta, created_at}
  cad_assemblies     {_id: project_id, owner, name, instances: [...], updated_at}
  cad_snapshots      {_id, project_id, label, auto, assembly: {name, instances}, versions: {part_id: version_id},
                      created_at}
  cad_messages       {_id, project_id, role, text, data, created_at}   the assistant conversation

Deleting a part only marks it (`deleted_at`, plus the copies it had in the
assembly), so it can be restored from the trash for TRASH_DAYS.

`source` is how the part started (generated / imported); every change makes
a new version, so the history of a part is its version chain.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.database import get_collection

PARTS = "cad_parts"
VERSIONS = "cad_part_versions"
ASSEMBLIES = "cad_assemblies"
SNAPSHOTS = "cad_snapshots"
MESSAGES = "cad_messages"
TRASH_DAYS = 30
MAX_SNAPSHOTS = 50
LIVE = {"deleted_at": None}


def _now():
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


async def ensure_indexes():
    await get_collection(PARTS).create_index([("project_id", 1)])
    await get_collection(VERSIONS).create_index([("part_id", 1), ("number", -1)])
    await get_collection(SNAPSHOTS).create_index([("project_id", 1), ("created_at", -1)])
    await get_collection(MESSAGES).create_index([("project_id", 1), ("created_at", 1)])


async def list_parts(project_id: str) -> list[dict]:
    return await get_collection(PARTS).find({"project_id": project_id, **LIVE}).sort("created_at", 1).to_list(None)


async def get_part(project_id: str, part_id: str, include_deleted: bool = False) -> Optional[dict]:
    query = {"_id": part_id, "project_id": project_id}
    if not include_deleted:
        query.update(LIVE)
    return await get_collection(PARTS).find_one(query)


async def create_part(project_id: str, owner: Optional[str], name: str, source: str, kind: str,
                      color: str, slug: Optional[str] = None, spec: Optional[dict] = None) -> dict:
    doc = {
        "_id": new_id(),
        "project_id": project_id,
        "owner": owner,
        "name": name,
        "source": source,
        "kind": kind,
        "color": color,
        "slug": slug,  # the id the plan uses for this part
        "spec": spec,  # the plan's design intent: role, features, ports, checks, interfaces, envelope
        "current_version": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await get_collection(PARTS).insert_one(doc)
    return doc


async def update_part(part_id: str, fields: dict) -> None:
    await get_collection(PARTS).update_one({"_id": part_id}, {"$set": {**fields, "updated_at": _now()}})


async def trash_part(project_id: str, part_id: str, instances: list[dict]) -> None:
    """Soft delete: hide the part and remember where its copies were."""
    await get_collection(PARTS).update_one(
        {"_id": part_id, "project_id": project_id},
        {"$set": {"deleted_at": _now(), "deleted_instances": instances}},
    )


async def list_trash(project_id: str) -> list[dict]:
    await purge_trash(project_id)
    return await get_collection(PARTS).find(
        {"project_id": project_id, "deleted_at": {"$ne": None}}
    ).sort("deleted_at", -1).to_list(200)


async def untrash_part(project_id: str, part_id: str) -> Optional[dict]:
    part = await get_part(project_id, part_id, include_deleted=True)
    if not part or not part.get("deleted_at"):
        return None
    await get_collection(PARTS).update_one(
        {"_id": part_id}, {"$set": {"deleted_at": None, "updated_at": _now()}, "$unset": {"deleted_instances": ""}}
    )
    part["deleted_at"] = None
    return part


async def purge_trash(project_id: str) -> None:
    """Permanently remove parts deleted more than TRASH_DAYS ago."""
    cutoff = _now() - timedelta(days=TRASH_DAYS)
    old = await get_collection(PARTS).find(
        {"project_id": project_id, "deleted_at": {"$ne": None, "$lt": cutoff}}, {"_id": 1}
    ).to_list(None)
    ids = [p["_id"] for p in old]
    if ids:
        await get_collection(PARTS).delete_many({"_id": {"$in": ids}})
        await get_collection(VERSIONS).delete_many({"part_id": {"$in": ids}})


# ── Snapshots ────────────────────────────────────────────────────────────


async def create_snapshot(project_id: str, label: str, auto: bool) -> Optional[dict]:
    """Record the assembly and every part's current version. Skipped for an
    empty assembly, and for an automatic snapshot identical to the last one."""
    assembly = await get_assembly(project_id)
    if not assembly.get("instances"):
        return None
    parts = await list_parts(project_id)
    versions = {p["_id"]: p.get("current_version") for p in parts}
    content = {"name": assembly.get("name", "Assembly"), "instances": assembly["instances"]}
    last = await get_collection(SNAPSHOTS).find_one({"project_id": project_id}, sort=[("created_at", -1)])
    if auto and last and last.get("assembly") == content and last.get("versions") == versions:
        return None
    doc = {"_id": new_id(), "project_id": project_id, "label": label[:120], "auto": auto,
           "assembly": content, "versions": versions, "created_at": _now()}
    await get_collection(SNAPSHOTS).insert_one(doc)
    old = await get_collection(SNAPSHOTS).find({"project_id": project_id}, {"_id": 1}).sort(
        "created_at", -1).skip(MAX_SNAPSHOTS).to_list(None)
    if old:
        await get_collection(SNAPSHOTS).delete_many({"_id": {"$in": [o["_id"] for o in old]}})
    return doc


async def list_snapshots(project_id: str) -> list[dict]:
    return await get_collection(SNAPSHOTS).find({"project_id": project_id}).sort("created_at", -1).to_list(
        MAX_SNAPSHOTS)


async def get_snapshot(project_id: str, snapshot_id: str) -> Optional[dict]:
    return await get_collection(SNAPSHOTS).find_one({"_id": snapshot_id, "project_id": project_id})


async def delete_snapshot(project_id: str, snapshot_id: str) -> None:
    await get_collection(SNAPSHOTS).delete_one({"_id": snapshot_id, "project_id": project_id})


# ── Assistant conversation ───────────────────────────────────────────────


async def add_message(project_id: str, role: str, text: str, data: Optional[dict] = None) -> dict:
    doc = {"_id": new_id(), "project_id": project_id, "role": role, "text": text[:8000],
           "data": data or {}, "created_at": _now()}
    await get_collection(MESSAGES).insert_one(doc)
    return doc


async def list_messages(project_id: str, limit: int = 300) -> list[dict]:
    docs = await get_collection(MESSAGES).find({"project_id": project_id}).sort("created_at", -1).to_list(limit)
    return list(reversed(docs))


async def clear_messages(project_id: str) -> None:
    await get_collection(MESSAGES).delete_many({"project_id": project_id})


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


async def legacy_session(project_id: str) -> dict:
    """What the previous CAD chat saved for this project, if anything."""
    return await get_collection("cad_sessions").find_one({"session_id": project_id}) or {}


async def mark_legacy_migrated(project_id: str) -> None:
    await get_collection("cad_sessions").update_one({"session_id": project_id}, {"$set": {"studio_migrated": True}})


async def get_interfaces(project_id: str) -> dict:
    doc = await get_collection(ASSEMBLIES).find_one({"_id": project_id}, {"interfaces": 1})
    return (doc or {}).get("interfaces") or {}


async def merge_interfaces(project_id: str, interfaces: dict) -> None:
    if interfaces:
        await get_collection(ASSEMBLIES).update_one(
            {"_id": project_id}, {"$set": {f"interfaces.{k}": v for k, v in interfaces.items()}}, upsert=True)
