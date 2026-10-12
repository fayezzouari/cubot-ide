"""
Pool of warm geometry worker processes (see runner.py).

Jobs run in long-lived child processes that already imported CadQuery, and
are awaited with asyncio pipes, so a build never blocks the API's event loop.
A job that times out kills its worker, which is replaced; workers are also
recycled after a number of jobs to bound OCCT's memory growth.

Configured from the environment only (CAD_WORKERS, CAD_JOB_TIMEOUT,
CAD_WORKER_MAX_JOBS) because it also runs inside the geometry worker
service, which has no application settings.
"""
import asyncio
import json
import logging
import os
import sys
from typing import Optional

logger = logging.getLogger(__name__)

RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.py")
STREAM_LIMIT = 4 * 1024 * 1024  # replies are small; geometry goes to files


class GeometryJobError(Exception):
    """The job ran but failed (bad code, invalid geometry, timeout)."""


class _Worker:
    def __init__(self, proc: asyncio.subprocess.Process):
        self.proc = proc
        self.jobs = 0
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self):
        assert self.proc.stderr
        while True:
            line = await self.proc.stderr.readline()
            if not line:
                return
            logger.debug("[cad-worker %s] %s", self.proc.pid, line.decode(errors="replace").rstrip())

    @property
    def alive(self) -> bool:
        return self.proc.returncode is None

    async def kill(self):
        if self.alive:
            self.proc.kill()
            try:
                await asyncio.wait_for(self.proc.wait(), 5)
            except asyncio.TimeoutError:
                pass
        self._stderr_task.cancel()


class WorkerPool:
    def __init__(self, size: Optional[int] = None, timeout: Optional[float] = None, max_jobs: Optional[int] = None):
        self.size = size or int(os.environ.get("CAD_WORKERS", "2"))
        self.timeout = timeout or float(os.environ.get("CAD_JOB_TIMEOUT", "60"))
        self.max_jobs = max_jobs or int(os.environ.get("CAD_WORKER_MAX_JOBS", "100"))
        self._idle: Optional[asyncio.Queue] = None
        self._lock = asyncio.Lock()

    async def _spawn(self) -> _Worker:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-u", RUNNER,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=STREAM_LIMIT,
        )
        worker = _Worker(proc)
        assert proc.stdout
        line = await asyncio.wait_for(proc.stdout.readline(), 120)  # first CadQuery import
        if not line or not json.loads(line).get("ready"):
            await worker.kill()
            raise RuntimeError("Geometry worker failed to start")
        logger.info("[cad-pool] worker %s ready", proc.pid)
        return worker

    async def start(self):
        """Create the pool and warm every worker (idempotent)."""
        async with self._lock:
            if self._idle is not None:
                return
            idle: asyncio.Queue = asyncio.Queue()
            workers = await asyncio.gather(*(self._spawn() for _ in range(self.size)))
            for w in workers:
                idle.put_nowait(w)
            self._idle = idle

    async def run(self, job: dict, timeout: Optional[float] = None) -> dict:
        await self.start()
        assert self._idle is not None
        worker: _Worker = await self._idle.get()
        try:
            if not worker.alive:
                worker = await self._spawn()
            assert worker.proc.stdin and worker.proc.stdout
            worker.proc.stdin.write((json.dumps(job) + "\n").encode())
            await worker.proc.stdin.drain()
            try:
                line = await asyncio.wait_for(worker.proc.stdout.readline(), timeout or self.timeout)
            except asyncio.TimeoutError:
                await worker.kill()
                raise GeometryJobError(f"Geometry job timed out after {timeout or self.timeout:.0f}s")
            if not line:
                await worker.kill()
                raise GeometryJobError("Geometry worker crashed (out of memory or a fatal OCCT error)")
            worker.jobs += 1
            reply = json.loads(line)
            if not reply.get("ok"):
                raise GeometryJobError(reply.get("error") or "Geometry job failed")
            return reply["result"]
        finally:
            if not worker.alive or worker.jobs >= self.max_jobs:
                await worker.kill()
                try:
                    worker = await self._spawn()
                except Exception:
                    # Keep the dead worker in the pool; the next job respawns it.
                    logger.exception("[cad-pool] respawn failed")
            self._idle.put_nowait(worker)

    async def close(self):
        if self._idle is None:
            return
        while not self._idle.empty():
            await self._idle.get_nowait().kill()
        self._idle = None
