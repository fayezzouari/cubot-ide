import asyncio
import logging
from typing import AsyncGenerator, Optional

logger = logging.getLogger(__name__)

LIVE_ONLY = {"capture"}


class Job:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.done = False
        self.changed = asyncio.Condition()
        self.task: Optional[asyncio.Task] = None

    async def _wake(self) -> None:
        async with self.changed:
            self.changed.notify_all()


_jobs: dict[str, Job] = {}


def current(project_id: str) -> Optional[Job]:
    return _jobs.get(project_id)


def start(project_id: str, events: AsyncGenerator[dict, None]) -> Job:
    job = Job()
    _jobs[project_id] = job

    async def drain() -> None:
        try:
            async for event in events:
                job.events.append(event)
                await job._wake()
        except Exception:
            logger.exception("[cad] job for %s failed", project_id)
        finally:
            await events.aclose()
            job.done = True
            if _jobs.get(project_id) is job:
                del _jobs[project_id]
            await asyncio.shield(job._wake())

    job.task = asyncio.create_task(drain())
    return job


def stop(project_id: str) -> bool:
    job = current(project_id)
    if not job or not job.task:
        return False
    job.task.cancel()
    return True


async def follow(job: Job) -> AsyncGenerator[dict, None]:
    replayed = len(job.events)
    sent = 0
    while True:
        while sent < len(job.events):
            event = job.events[sent]
            sent += 1
            if sent <= replayed and event.get("type") in LIVE_ONLY:
                continue
            yield event
        if job.done:
            return
        async with job.changed:
            await job.changed.wait_for(lambda: sent < len(job.events) or job.done)
