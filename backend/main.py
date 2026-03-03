from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from core.database import connect_to_mongo, close_mongo_connection
from core.auth import get_current_user
from routes import (
    files_router,
    projects_router,
    compile_router,
    chat_router,
    serial_router,
    simulator_router,
    wiring_router,
    cad_router,
    blocks_router,
    arm_ws_router,
    components_router,
    daytona_router,
)
import uvicorn


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - startup and shutdown"""
    # Startup
    await connect_to_mongo(settings.MONGODB_URI, settings.MONGODB_DB_NAME)
    yield
    # Shutdown
    await close_mongo_connection()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.PROJECT_VERSION,
    lifespan=lifespan,
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.ALLOWED_ORIGINS],  # In production, allow specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
_auth = [Depends(get_current_user)]
app.include_router(files_router, prefix="/api", dependencies=_auth)
app.include_router(projects_router, prefix="/api", dependencies=_auth)
app.include_router(compile_router, prefix="/api", dependencies=_auth)
app.include_router(chat_router, prefix="/api", dependencies=_auth)
app.include_router(serial_router, prefix="/api", dependencies=_auth)
app.include_router(simulator_router)   # WebSocket — auth handled via token query param
app.include_router(arm_ws_router, prefix="/api")
app.include_router(wiring_router, prefix="/api", dependencies=_auth)
app.include_router(cad_router, prefix="/api", dependencies=_auth)
app.include_router(blocks_router, prefix="/api", dependencies=_auth)
app.include_router(components_router, prefix="/api", dependencies=_auth)
app.include_router(daytona_router, prefix="/api", dependencies=_auth)


@app.get("/")
async def root():
    return {"message": "Welcome to the Cubot IDE Backend"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.PROJECT_VERSION,
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

