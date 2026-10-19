import asyncio
import contextlib
import signal

from core.config import settings
from core.database import close_mongo_connection, connect_to_mongo
from services.fleet.coordinator.manager import manager


async def _main() -> None:
    await connect_to_mongo(settings.MONGODB_URI, settings.MONGODB_DB_NAME)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    await manager.start()
    print(f"Fleet coordinator running against mqtt://{settings.FLEET_MQTT_HOST}:{settings.FLEET_MQTT_PORT}")
    try:
        await stop.wait()
    finally:
        await manager.stop()
        await close_mongo_connection()
        print("Fleet coordinator stopped")


if __name__ == "__main__":
    asyncio.run(_main())
