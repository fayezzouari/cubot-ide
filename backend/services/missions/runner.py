import asyncio
import time
import uuid
from typing import List, Optional

from schemas.missions import AnalogStep, DigitalStep, Mission, MissionRun, SerialStep
from services.missions.grader import SimEvent, grade
from services.simulation_service import SimulationState, simulation_service

BOOT_TIMEOUT_S = 20.0
POLL_S = 0.01


class _Clock:
    def __init__(self) -> None:
        self.sim_ms: Optional[float] = None
        self.ready_at: Optional[float] = None

    def mark_ready(self) -> None:
        if self.ready_at is None:
            self.ready_at = time.monotonic()

    def observe(self, t: Optional[float]) -> None:
        if t is not None:
            self.sim_ms = max(self.sim_ms or 0.0, float(t))

    def now(self) -> Optional[float]:
        if self.sim_ms is not None:
            return self.sim_ms
        if self.ready_at is not None:
            return (time.monotonic() - self.ready_at) * 1000
        return None


async def run_mission(mission: Mission, hex_data: str) -> MissionRun:
    session_id = f"mission-{uuid.uuid4().hex}"
    events: List[SimEvent] = []
    clock = _Clock()
    failure: List[str] = []
    finished = asyncio.Event()

    async def on_event(msg: dict) -> None:
        kind = msg.get("type")
        if kind == "ready":
            clock.mark_ready()
            return
        clock.observe(msg.get("t"))
        if kind not in ("pin", "serial"):
            return
        stamp = clock.now() or 0.0
        events.append(SimEvent(
            t=float(msg.get("t", stamp)),
            type=kind,
            pin=msg.get("pin"),
            value=msg.get("value"),
            data=msg.get("data", ""),
        ))

    async def ignore(*_args) -> None:
        return None

    async def on_state(state: SimulationState) -> None:
        if state in (SimulationState.STOPPED, SimulationState.ERROR):
            if state == SimulationState.ERROR:
                failure.append("The simulator stopped with an error.")
            finished.set()

    async def simulate() -> None:
        try:
            await simulation_service.start_simulation(
                session_id=session_id,
                hex_data=hex_data,
                on_serial=ignore,
                on_pin_change=ignore,
                on_state_change=on_state,
                on_event=on_event,
            )
        except Exception as exc:
            failure.append(str(exc))
        finally:
            finished.set()

    async def send(step) -> None:
        if isinstance(step, AnalogStep):
            await simulation_service.send_analog_input(session_id, step.channel, step.millivolts)
        elif isinstance(step, DigitalStep):
            await simulation_service.send_digital_input(session_id, step.pin, step.value)
        elif isinstance(step, SerialStep):
            await simulation_service.send_serial_input(session_id, step.data)

    task = asyncio.create_task(simulate())
    pending = sorted(mission.scenario, key=lambda s: s.at_ms)
    started = time.monotonic()
    wall_limit = BOOT_TIMEOUT_S + mission.duration_ms / 1000 * 4

    try:
        while not finished.is_set():
            elapsed = time.monotonic() - started
            now = clock.now()
            if now is None and elapsed > BOOT_TIMEOUT_S:
                failure.append("The simulator did not start.")
                break
            if elapsed > wall_limit:
                failure.append("The simulation ran too slowly to finish.")
                break
            if now is not None:
                while pending and pending[0].at_ms <= now:
                    await send(pending.pop(0))
                if now >= mission.duration_ms:
                    break
            await asyncio.sleep(POLL_S)
    finally:
        await simulation_service.stop_simulation(session_id)
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    reached = clock.now()
    if not failure and (reached is None or reached < mission.duration_ms):
        failure.append(
            "The simulator did not start." if reached is None
            else f"The simulator stopped after {reached:.0f} ms, before the checks finished."
        )

    sim_clock = clock.sim_ms is not None
    results = grade(mission.checks, events)
    serial = "".join(e.data for e in sorted(events, key=lambda e: e.t) if e.type == "serial")
    error = failure[0] if failure else None
    return MissionRun(
        mission_id=mission.id,
        passed=error is None and bool(results) and all(r.passed for r in results),
        results=results,
        serial=serial[-4000:],
        duration_ms=int(clock.now() or 0),
        sim_clock=sim_clock,
        error=error,
    )
