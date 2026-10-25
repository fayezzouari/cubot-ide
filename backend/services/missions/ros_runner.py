import asyncio
import json
from pathlib import Path
from typing import Dict

from schemas.missions import CallStep, CheckResult, Mission, MissionRun, PublishStep
from services.file_service import FileService
from services.missions.ros_grader import grade, subscriptions
from services.missions.ros_harness import MARKER
from services.sandbox_service import sandbox_service

HARNESS = Path(__file__).parent / "ros_harness.py"
RUN_DIR = "/tmp/cubot-mission/project"
HARNESS_PATH = "/tmp/cubot-mission/harness.py"
DOMAIN_ID = "77"
OUTPUT_LIMIT = 4000

RUN_SCRIPT = (
    "source /opt/ros/humble/setup.bash && cd \"$1\" && "
    f"ROS_DOMAIN_ID={DOMAIN_ID} python3 \"$2\" \"$3\""
)

_project_locks: Dict[str, asyncio.Lock] = {}


def _relative_path(path: str, name: str) -> str:
    raw = (path or "").strip("/")
    if not raw or raw == "." or raw == name:
        return name
    if raw.endswith("/" + name):
        return raw
    return f"{raw}/{name}"


def _failure(mission: Mission, error: str, output: str = "") -> MissionRun:
    return MissionRun(
        mission_id=mission.id, passed=False, results=[], serial=output[-OUTPUT_LIMIT:],
        duration_ms=0, sim_clock=False, error=error,
    )


def _spec(mission: Mission) -> dict:
    scenario = [
        step.model_dump() for step in mission.scenario if isinstance(step, (PublishStep, CallStep))
    ]
    return {
        "duration_ms": mission.duration_ms,
        "run": mission.run,
        "subscribe": [{"topic": topic, "msg_type": msg_type} for topic, msg_type in subscriptions(mission.checks)],
        "scenario": scenario,
    }


async def _upload(pod_name: str, project_id: str) -> None:
    reset = await sandbox_service.run_in_pod(pod_name, 'rm -rf "$1" && mkdir -p "$1"', RUN_DIR)
    if reset.exit_code != 0:
        raise RuntimeError(reset.stderr.strip() or "Could not prepare the sandbox")
    for file in await FileService.get_files_by_project(project_id):
        if not file.name:
            continue
        target = f"{RUN_DIR}/{_relative_path(file.path, file.name)}"
        await sandbox_service.write_pod_file(pod_name, target, (file.content or "").encode("utf-8"))
    await sandbox_service.write_pod_file(pod_name, HARNESS_PATH, HARNESS.read_bytes())


SHUTDOWN_ERRORS = ("KeyboardInterrupt", "ExternalShutdownException")


def _without_shutdown_trace(output: str) -> str:
    start = output.rfind("Traceback (most recent call last):")
    if start != -1 and any(name in output[start:] for name in SHUTDOWN_ERRORS):
        return output[:start]
    return output


def _process_output(processes: list) -> str:
    blocks = []
    for process in processes:
        output = process.get("output", "")
        if process.get("exit_code") is None:
            output = _without_shutdown_trace(output)
        if output.strip():
            blocks.append(f"$ {process['command']}\n{output.rstrip()}")
    return "\n".join(blocks)


def _keeps_running(processes: list) -> CheckResult:
    for process in processes:
        code = process.get("exit_code")
        if code is not None:
            how = "crashed" if code else "exited"
            return CheckResult(
                id="running", label="Your nodes keep running", passed=False,
                detail=f"`{process['command']}` {how} (exit code {code}) before the checks finished. See its output below.",
            )
    return CheckResult(id="running", label="Your nodes keep running", passed=True,
                       detail="Every node ran until the end of the check.")


async def run_ros_mission(mission: Mission, project_id: str) -> MissionRun:
    lock = _project_locks.setdefault(project_id, asyncio.Lock())
    async with lock:
        try:
            pod_name = await sandbox_service.ensure_pod(project_id)
            await _upload(pod_name, project_id)
            result = await sandbox_service.run_in_pod(
                pod_name, RUN_SCRIPT, RUN_DIR, HARNESS_PATH, json.dumps(_spec(mission)),
                timeout=mission.duration_ms // 1000 + 30,
            )
        except Exception as exc:
            return _failure(mission, f"The ROS 2 sandbox is not available: {exc}")

    line = next((row for row in result.stdout.splitlines() if row.startswith(MARKER)), None)
    if line is None:
        return _failure(mission, "The checker did not finish in the sandbox.", result.stderr or result.stdout)
    report = json.loads(line[len(MARKER):])
    if report.get("error"):
        return _failure(mission, f"The checker failed: {report['error']}")

    processes = report.get("processes", [])
    results = [_keeps_running(processes), *grade(mission.checks, report)]
    return MissionRun(
        mission_id=mission.id,
        passed=all(r.passed for r in results),
        results=results,
        serial=_process_output(processes)[-OUTPUT_LIMIT:],
        duration_ms=int(report.get("duration_ms", 0)),
        sim_clock=False,
    )
