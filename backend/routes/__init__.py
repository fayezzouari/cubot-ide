from routes.files import router as files_router
from routes.projects import router as projects_router
from routes.compile import router as compile_router
from routes.chat import router as chat_router
from routes.serial import router as serial_router
from routes.simulator import router as simulator_router

__all__ = [
    "files_router",
    "projects_router",
    "compile_router",
    "chat_router",
    "serial_router",
    "simulator_router",
]
