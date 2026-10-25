from dataclasses import dataclass
from statistics import median
from typing import List, Optional

from schemas.missions import (
    CheckResult,
    MissionCheck,
    PinStateCheck,
    PinTogglesCheck,
    SerialContainsCheck,
)


@dataclass
class SimEvent:
    t: float
    type: str
    pin: Optional[int] = None
    value: Optional[bool] = None
    data: str = ""


def pin_level_at(events: List[SimEvent], pin: int, at_ms: float) -> bool:
    level = False
    for event in events:
        if event.t > at_ms:
            break
        if event.type == "pin" and event.pin == pin:
            level = bool(event.value)
    return level


def serial_between(events: List[SimEvent], after_ms: float, before_ms: Optional[float]) -> str:
    return "".join(
        e.data for e in events
        if e.type == "serial" and e.t >= after_ms and (before_ms is None or e.t <= before_ms)
    )


def _edges(events: List[SimEvent], pin: int, after_ms: float) -> List[float]:
    edges: List[float] = []
    level: Optional[bool] = None
    for event in events:
        if event.type != "pin" or event.pin != pin:
            continue
        if level is not None and event.value != level and event.t >= after_ms:
            edges.append(event.t)
        level = bool(event.value)
    return edges


def _check_toggles(check: PinTogglesCheck, events: List[SimEvent]) -> CheckResult:
    edges = _edges(events, check.pin, check.after_ms)
    if len(edges) < check.min_edges:
        detail = (
            f"Pin {check.pin} never changed." if not edges
            else f"Pin {check.pin} changed {len(edges)} time(s); expected at least {check.min_edges}."
        )
        return CheckResult(id=check.id, label=check.label, passed=False, detail=detail)

    intervals = [b - a for a, b in zip(edges, edges[1:])]
    typical = median(intervals)
    low, high = check.interval_ms * (1 - check.tolerance), check.interval_ms * (1 + check.tolerance)
    off = [i for i in intervals if not low <= i <= high]
    if low <= typical <= high and len(off) <= len(intervals) // 4:
        return CheckResult(
            id=check.id, label=check.label, passed=True,
            detail=f"Pin {check.pin} toggled every {typical:.0f} ms ({len(edges)} edges).",
        )
    return CheckResult(
        id=check.id, label=check.label, passed=False,
        detail=f"Pin {check.pin} toggles every {typical:.0f} ms; expected {check.interval_ms} ms ± {check.tolerance:.0%}.",
    )


def _check_state(check: PinStateCheck, events: List[SimEvent]) -> CheckResult:
    level = pin_level_at(events, check.pin, check.at_ms)
    name = "HIGH" if check.value else "LOW"
    seen = "HIGH" if level else "LOW"
    return CheckResult(
        id=check.id, label=check.label, passed=level == check.value,
        detail=f"Pin {check.pin} was {seen} at {check.at_ms} ms; expected {name}.",
    )


def _check_serial(check: SerialContainsCheck, events: List[SimEvent]) -> CheckResult:
    text = serial_between(events, check.after_ms, check.before_ms)
    found = check.text in text
    window = f"between {check.after_ms} and {check.before_ms} ms" if check.before_ms is not None else f"after {check.after_ms} ms"
    if check.absent:
        detail = f'"{check.text}" was printed {window} but should not be.' if found else f'"{check.text}" was not printed {window}.'
        return CheckResult(id=check.id, label=check.label, passed=not found, detail=detail)
    detail = f'Found "{check.text}" {window}.' if found else f'"{check.text}" was not printed {window}.'
    return CheckResult(id=check.id, label=check.label, passed=found, detail=detail)


def grade(checks: List[MissionCheck], events: List[SimEvent]) -> List[CheckResult]:
    ordered = sorted(events, key=lambda e: e.t)
    results: List[CheckResult] = []
    for check in checks:
        if isinstance(check, PinTogglesCheck):
            results.append(_check_toggles(check, ordered))
        elif isinstance(check, PinStateCheck):
            results.append(_check_state(check, ordered))
        elif isinstance(check, SerialContainsCheck):
            results.append(_check_serial(check, ordered))
    return results
