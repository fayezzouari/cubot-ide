from dataclasses import dataclass


@dataclass(frozen=True)
class Vda5050Topics:
    interface: str = "uagv"
    major_version: int = 2

    def _prefix(self) -> str:
        return f"{self.interface}/v{self.major_version}"

    def topic(self, manufacturer: str, serial: str, message_type: str) -> str:
        return f"{self._prefix()}/{manufacturer}/{serial}/{message_type}"

    def subscribe_wildcard(self, message_type: str) -> str:
        return f"{self._prefix()}/+/+/{message_type}"


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
