import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

from schemas.missions import Mission

CONTENT_DIR = Path(__file__).parent / "content"


@lru_cache(maxsize=1)
def _load() -> Dict[str, Mission]:
    missions: Dict[str, Mission] = {}
    for path in sorted(CONTENT_DIR.glob("*.json")):
        mission = Mission.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if mission.id in missions:
            raise ValueError(f"Duplicate mission id {mission.id!r} in {path.name}")
        missions[mission.id] = mission
    return missions


def all_missions() -> List[Mission]:
    return sorted(_load().values(), key=lambda m: m.order)


def get_mission(mission_id: str) -> Optional[Mission]:
    return _load().get(mission_id)
