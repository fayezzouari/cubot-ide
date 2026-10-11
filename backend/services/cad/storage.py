"""
Content-addressed storage for CAD files.

  objects/<key>/   one built part version: part.step, part.stl, mesh.json, meta.json
  assets/<sha>/    an uploaded file (STEP, STL, DXF, …) referenced by part code
  exports/<id>/    assembly exports, removed after EXPORT_TTL

A build's key is a hash of everything that determines its geometry (code,
parameters, assets, runner version), so identical builds are served from
disk instead of being recomputed.
"""
import hashlib
import json
import os
import shutil
import time
from typing import Optional

from core.config import settings

# Bump when the runner's output changes so old cached builds are not reused.
RUNNER_VERSION = "3"  # 2: ports in meta, 3: port checks
EXPORT_TTL = 24 * 3600
OBJECT_FILES = {"part.step", "part.stl", "mesh.json", "meta.json"}


def root() -> str:
    return settings.CAD_STORAGE_DIR


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_key(code: str, params: dict, assets: dict[str, str]) -> str:
    payload = json.dumps(
        {"v": RUNNER_VERSION, "code": code, "params": params, "assets": assets},
        sort_keys=True,
    )
    return _hash(payload.encode())[:40]


def object_dir(key: str) -> str:
    return os.path.join(root(), "objects", key)


def object_path(key: str, name: str) -> Optional[str]:
    if name not in OBJECT_FILES or not key.isalnum():
        return None
    path = os.path.join(object_dir(key), name)
    return path if os.path.exists(path) else None


def cached_meta(key: str) -> Optional[dict]:
    path = object_path(key, "meta.json")
    if not path:
        return None
    with open(path) as f:
        return json.load(f)


def save_asset(filename: str, data: bytes) -> tuple[str, str]:
    """Store an uploaded file; returns (asset id, path)."""
    sha = _hash(data)[:40]
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in os.path.basename(filename)) or "file"
    folder = os.path.join(root(), "assets", sha)
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, safe)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(data)
    return sha, path


def asset_path(sha: str, filename: str) -> str:
    return os.path.join(root(), "assets", sha, filename)


def new_export_path(filename: str) -> str:
    prune_exports()
    folder = os.path.join(root(), "exports", _hash(f"{time.time_ns()}{filename}".encode())[:24])
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, filename)


def prune_exports() -> None:
    base = os.path.join(root(), "exports")
    if not os.path.isdir(base):
        return
    cutoff = time.time() - EXPORT_TTL
    for name in os.listdir(base):
        path = os.path.join(base, name)
        try:
            if os.path.getmtime(path) < cutoff:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass
