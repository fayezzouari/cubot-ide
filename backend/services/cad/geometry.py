"""
Where geometry jobs run.

With CAD_WORKER_URL set (production), jobs go to the sandboxed geometry
worker service over HTTP. Without it (local development), they run in an
in-process pool of warm worker processes. Both read and write the same CAD
storage directory.
"""
import asyncio
import logging
from typing import Optional

import httpx

from core.config import settings
from services.cad.pool import GeometryJobError, WorkerPool

logger = logging.getLogger(__name__)

__all__ = ["GeometryJobError", "geometry"]


class Geometry:
    def __init__(self):
        self._pool: Optional[WorkerPool] = None
        self._client: Optional[httpx.AsyncClient] = None

    async def start(self):
        if settings.CAD_WORKER_URL:
            self._client = httpx.AsyncClient(base_url=settings.CAD_WORKER_URL, timeout=180)
        else:
            self._pool = WorkerPool()
            # Warm the workers in the background so startup isn't delayed.
            asyncio.create_task(self._warm())

    async def _warm(self):
        try:
            await self._pool.start()
        except Exception:
            logger.exception("[cad] failed to warm geometry workers")

    async def close(self):
        if self._pool:
            await self._pool.close()
        if self._client:
            await self._client.aclose()

    async def run(self, job: dict) -> dict:
        if self._client is None and self._pool is None:
            await self.start()
        if self._client is not None:
            try:
                resp = await self._client.post("/jobs", json=job)
            except httpx.HTTPError as e:
                raise GeometryJobError(f"Geometry worker unreachable: {e}") from e
            data = resp.json()
            if not data.get("ok"):
                raise GeometryJobError(data.get("error") or "Geometry job failed")
            return data["result"]
        return await self._pool.run(job)


geometry = Geometry()
