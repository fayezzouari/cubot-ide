from dataclasses import dataclass

from core.config import settings


def _prefix() -> str:
    return f"{settings.FLEET_UAV_INTERFACE}/v{settings.FLEET_UAV_MAJOR_VERSION}"


def topic(manufacturer: str, serial: str, message_type: str) -> str:
    return f"{_prefix()}/{manufacturer}/{serial}/{message_type}"


def subscribe_wildcard(message_type: str) -> str:
    return f"{_prefix()}/+/+/{message_type}"


@dataclass(frozen=True)
class ParsedTopic:
    interface: str
    major_version: int
    manufacturer: str
    serial: str
    message_type: str


def parse(topic_str: str) -> ParsedTopic | None:
    parts = topic_str.split("/")
    if len(parts) != 5 or not parts[1].startswith("v"):
        return None
    try:
        major = int(parts[1][1:])
    except ValueError:
        return None
    return ParsedTopic(parts[0], major, parts[2], parts[3], parts[4])
