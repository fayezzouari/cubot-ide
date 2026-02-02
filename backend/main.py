from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from core.database import connect_to_mongo, close_mongo_connection
from routes import files_router, projects_router, compile_router, chat_router
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
    allow_origins=["*"],  # In production, allow specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(files_router, prefix="/api")
app.include_router(projects_router, prefix="/api")
app.include_router(compile_router, prefix="/api")
app.include_router(chat_router, prefix="/api")


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

