"""
Geometry worker service: runs part code and exports away from the API.

    uvicorn services.cad.server:app --host 0.0.0.0 --port 8100

Deployed as its own container with no Docker socket, no secrets and no
outbound network (see docker-compose.yml, `cad-worker`), so code written by
the model can't reach anything but the shared CAD storage volume.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from services.cad.pool import GeometryJobError, WorkerPool

pool = WorkerPool()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.start()
    yield
    await pool.close()


app = FastAPI(title="CuBot geometry worker", lifespan=lifespan)


@app.post("/jobs")
async def run_job(job: dict):
    try:
        return {"ok": True, "result": await pool.run(job)}
    except GeometryJobError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=422)


@app.get("/health")
async def health():
    return {"status": "ok", "workers": pool.size}
