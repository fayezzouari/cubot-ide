from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import serial

from services.project_service import project_service

router = APIRouter()


@router.websocket("/ws/serial")
async def serial_monitor(websocket: WebSocket):
    await websocket.accept()

    project_id = websocket.query_params.get("project_id")
    port = websocket.query_params.get("port")
    baud_param = websocket.query_params.get("baud", "115200")

    if not project_id or not port:
        await websocket.close(code=1008)
        return

    project = await project_service.get_project(project_id)
    if not project or project.target_compiler != "arduino":
        await websocket.close(code=1008)
        return

    try:
        baud = int(baud_param)
    except ValueError:
        await websocket.close(code=1008)
        return

    try:
        ser = serial.Serial(port, baudrate=baud, timeout=1)
    except Exception as e:
        await websocket.send_text(f"[error] {str(e)}")
        await websocket.close(code=1011)
        return

    async def read_serial():
        while True:
            line = await asyncio.to_thread(ser.readline)
            if not line:
                await asyncio.sleep(0.05)
                continue
            try:
                text = line.decode(errors="replace").rstrip("\n")
            except Exception:
                text = str(line)
            await websocket.send_text(text)

    async def read_ws():
        try:
            while True:
                message = await websocket.receive_text()
                ser.write((message + "\n").encode())
        except WebSocketDisconnect:
            pass

    serial_task = asyncio.create_task(read_serial())
    ws_task = asyncio.create_task(read_ws())

    try:
        await asyncio.wait(
            [serial_task, ws_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        serial_task.cancel()
        ws_task.cancel()
        try:
            ser.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
