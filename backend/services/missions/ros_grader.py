from statistics import median
from typing import Any, Dict, List, Optional, Tuple

from schemas.missions import (
    CheckResult,
    MissionCheck,
    NodeRunningCheck,
    ServiceResponseCheck,
    TopicPublishedCheck,
    TopicValueCheck,
)

_MISSING = object()


def field_value(data: Any, path: Optional[str]) -> Any:
    if not path:
        return data
    value = data
    for part in path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return _MISSING
    return value


def _matches(value: Any, expected: Any, tolerance: Optional[float]) -> bool:
    numeric = isinstance(value, (int, float)) and isinstance(expected, (int, float))
    if numeric and not isinstance(value, bool) and not isinstance(expected, bool):
        return abs(value - expected) <= (tolerance or 0)
    return value == expected


def _show(value: Any) -> str:
    if value is _MISSING:
        return "missing"
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, str):
        return f'"{value}"'
    return str(value).lower() if isinstance(value, bool) else str(value)


def _on_topic(messages: List[Dict[str, Any]], topic: str, after_ms: float, before_ms: Optional[float]) -> List[Dict[str, Any]]:
    return [
        m for m in messages
        if m["topic"] == topic and m["t"] >= after_ms and (before_ms is None or m["t"] <= before_ms)
    ]


def _check_published(check: TopicPublishedCheck, messages: List[Dict[str, Any]]) -> CheckResult:
    window = _on_topic(messages, check.topic, check.after_ms, check.before_ms)
    if not window:
        return CheckResult(id=check.id, label=check.label, passed=False,
                           detail=f"Nothing was published on {check.topic}.")

    if check.contains is not None:
        matching = [m for m in window if check.contains in str(field_value(m["data"], check.field))]
        if len(matching) < check.min_count:
            sample = _show(field_value(window[-1]["data"], check.field))
            return CheckResult(
                id=check.id, label=check.label, passed=False,
                detail=f'{len(matching)} of {len(window)} messages on {check.topic} contained "{check.contains}"; '
                       f"expected at least {check.min_count}. Last one was {sample}.",
            )
    elif len(window) < check.min_count:
        return CheckResult(
            id=check.id, label=check.label, passed=False,
            detail=f"{len(window)} message(s) on {check.topic}; expected at least {check.min_count}.",
        )

    if check.rate_hz is not None:
        intervals = [b["t"] - a["t"] for a, b in zip(window, window[1:])]
        if not intervals:
            return CheckResult(id=check.id, label=check.label, passed=False,
                               detail=f"Only one message on {check.topic}, so there is no rate to measure.")
        rate = 1000 / median(intervals) if median(intervals) > 0 else float("inf")
        low, high = check.rate_hz * (1 - check.tolerance), check.rate_hz * (1 + check.tolerance)
        if not low <= rate <= high:
            return CheckResult(
                id=check.id, label=check.label, passed=False,
                detail=f"{check.topic} publishes at {rate:.1f} Hz; expected {check.rate_hz:g} Hz ± {check.tolerance:.0%}.",
            )
        return CheckResult(id=check.id, label=check.label, passed=True,
                           detail=f"{check.topic} published {len(window)} messages at {rate:.1f} Hz.")

    return CheckResult(id=check.id, label=check.label, passed=True,
                       detail=f"{check.topic} published {len(window)} message(s).")


def _check_value(check: TopicValueCheck, messages: List[Dict[str, Any]]) -> CheckResult:
    window = _on_topic(messages, check.topic, check.after_ms, check.at_ms)
    if not window:
        return CheckResult(
            id=check.id, label=check.label, passed=False,
            detail=f"Nothing was published on {check.topic} between {check.after_ms} and {check.at_ms} ms.",
        )
    value = field_value(window[-1]["data"], check.field)
    passed = value is not _MISSING and _matches(value, check.equals, check.tolerance)
    return CheckResult(
        id=check.id, label=check.label, passed=passed,
        detail=f"{check.topic} {check.field} was {_show(value)} at {check.at_ms} ms; expected {_show(check.equals)}.",
    )


def _check_service(check: ServiceResponseCheck, calls: List[Dict[str, Any]]) -> CheckResult:
    call = next((c for c in calls if c["id"] == check.call), None)
    if call is None or not call.get("ok"):
        detail = call.get("error") if call else "The service was never called."
        return CheckResult(id=check.id, label=check.label, passed=False, detail=detail)
    value = field_value(call.get("response"), check.field)
    passed = value is not _MISSING and _matches(value, check.equals, None)
    return CheckResult(
        id=check.id, label=check.label, passed=passed,
        detail=f"The response {check.field} was {_show(value)}; expected {_show(check.equals)}.",
    )


def _check_node(check: NodeRunningCheck, nodes: List[str]) -> CheckResult:
    names = {n.rsplit("/", 1)[-1] for n in nodes}
    if check.name in names:
        return CheckResult(id=check.id, label=check.label, passed=True, detail=f"Node {check.name} is running.")
    seen = ", ".join(sorted(names)) if names else "none"
    return CheckResult(
        id=check.id, label=check.label, passed=False,
        detail=f"No node named {check.name} was running. Nodes seen: {seen}.",
    )


def subscriptions(checks: List[MissionCheck]) -> List[Tuple[str, str]]:
    topics: List[Tuple[str, str]] = []
    for check in checks:
        if isinstance(check, (TopicPublishedCheck, TopicValueCheck)) and (check.topic, check.msg_type) not in topics:
            topics.append((check.topic, check.msg_type))
    return topics


def grade(checks: List[MissionCheck], result: Dict[str, Any]) -> List[CheckResult]:
    messages = sorted(result.get("messages", []), key=lambda m: m["t"])
    calls = result.get("calls", [])
    nodes = result.get("nodes", [])
    results: List[CheckResult] = []
    for check in checks:
        if isinstance(check, TopicPublishedCheck):
            results.append(_check_published(check, messages))
        elif isinstance(check, TopicValueCheck):
            results.append(_check_value(check, messages))
        elif isinstance(check, ServiceResponseCheck):
            results.append(_check_service(check, calls))
        elif isinstance(check, NodeRunningCheck):
            results.append(_check_node(check, nodes))
    return results
