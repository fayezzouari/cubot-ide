"""
Simulation WebSocket route.

Provides a WebSocket endpoint for running AVR simulations.
The client sends hex data and receives continuous pin state and serial output updates.

Protocol (JSON messages over WebSocket):

Client → Server:
  {"type": "start", "hex": "<intel hex content>"}
  {"type": "stop"}
  {"type": "serial_input", "data": "text to send"}

Server → Client:
  {"type": "state", "state": "starting|running|stopped|error"}
  {"type": "serial", "data": "characters from AVR serial"}
  {"type": "pin", "pin": 0-13, "value": true/false}
  {"type": "error", "message": "error description"}
"""

import uuid
import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.simulation_service import simulation_service, SimulationState

router = APIRouter()


@router.websocket("/ws/simulate")
async def simulate_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for AVR simulation.
    
    Flow:
    1. Client connects
    2. Client sends {"type": "start", "hex": "..."} with compiled hex data
    3. Server starts simulation and streams pin/serial events
    4. Client can send {"type": "stop"} to end the simulation
    5. Client can send {"type": "serial_input", "data": "..."} to send serial data to the AVR
    """
    await websocket.accept()

    session_id = str(uuid.uuid4())
    simulation_task: asyncio.Task | None = None

    async def send_json(data: dict):
        """Safely send JSON to the WebSocket client."""
        try:
            await websocket.send_text(json.dumps(data))
        except Exception:
            pass

    async def on_serial(data: str):
        await send_json({"type": "serial", "data": data})

    async def on_pin_change(pin: int, value: bool):
        await send_json({"type": "pin", "pin": pin, "value": value})

    async def on_state_change(state: SimulationState):
        await send_json({"type": "state", "state": state.value})

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "start":
                hex_data = msg.get("hex")
                if not hex_data:
                    await send_json({"type": "error", "message": "Missing hex data"})
                    continue

                # Stop any existing simulation
                if simulation_task and not simulation_task.done():
                    await simulation_service.stop_simulation(session_id)
                    simulation_task.cancel()
                    try:
                        await simulation_task
                    except (asyncio.CancelledError, Exception):
                        pass

                # Start simulation in background task
                async def run_sim(hex_content: str):
                    try:
                        await simulation_service.start_simulation(
                            session_id=session_id,
                            hex_data=hex_content,
                            on_serial=on_serial,
                            on_pin_change=on_pin_change,
                            on_state_change=on_state_change,
                        )
                    except Exception as e:
                        await send_json({"type": "error", "message": str(e)})

                simulation_task = asyncio.create_task(run_sim(hex_data))

            elif msg_type == "stop":
                if simulation_task and not simulation_task.done():
                    await simulation_service.stop_simulation(session_id)
                    simulation_task.cancel()
                    try:
                        await simulation_task
                    except (asyncio.CancelledError, Exception):
                        pass
                await send_json({"type": "state", "state": "stopped"})

            elif msg_type == "serial_input":
                data = msg.get("data", "")
                if data:
                    await simulation_service.send_serial_input(session_id, data)

            else:
                await send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        # Cleanup: stop simulation on disconnect
        if simulation_task and not simulation_task.done():
            await simulation_service.stop_simulation(session_id)
            simulation_task.cancel()
            try:
                await simulation_task
            except (asyncio.CancelledError, Exception):
                pass
