"""
AVR Simulation Service

Manages simavr-based simulation of compiled Arduino hex files.
Runs simavr in a Docker container and parses VCD output for pin states
and serial output, streaming results back via callbacks.
"""

import asyncio
import json
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional, Any
from enum import Enum

from core.config import settings


class SimulationState(str, Enum):
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass
class SimulationSession:
    """Tracks a running simulation"""
    session_id: str
    hex_data: str
    state: SimulationState = SimulationState.IDLE
    process: Optional[asyncio.subprocess.Process] = None
    temp_dir: Optional[str] = None
    container_id: Optional[str] = None
    pin_states: Dict[int, bool] = field(default_factory=lambda: {i: False for i in range(14)})
    serial_buffer: str = ""


class SimulationService:
    """
    Manages AVR simulation sessions using simavr inside Docker.
    
    The simulation runs a custom simavr wrapper that:
    1. Loads the compiled .hex file
    2. Runs the ATmega328p simulation
    3. Outputs JSON-formatted pin changes and serial data to stdout
    """
    
    SIMULATOR_IMAGE = settings.SIMULATOR_IMAGE

    def __init__(self):
        self._sessions: Dict[str, SimulationSession] = {}

    async def start_simulation(
        self,
        session_id: str,
        hex_data: str,
        on_serial: Callable[[str], Any],
        on_pin_change: Callable[[int, bool], Any],
        on_state_change: Callable[[SimulationState], Any],
    ) -> SimulationSession:
        """
        Start a new AVR simulation.
        
        Args:
            session_id: Unique identifier for this simulation
            hex_data: Intel HEX content to simulate
            on_serial: Callback for serial output characters
            on_pin_change: Callback for digital pin state changes (pin, value)
            on_state_change: Callback for simulation state transitions
        
        Returns:
            SimulationSession tracking the running simulation
        """
        # Stop any existing session
        if session_id in self._sessions:
            await self.stop_simulation(session_id)

        session = SimulationSession(session_id=session_id, hex_data=hex_data)
        self._sessions[session_id] = session

        # Create temp directory and write hex file
        temp_dir = tempfile.mkdtemp(prefix="cubot_sim_")
        session.temp_dir = temp_dir

        hex_path = os.path.join(temp_dir, "firmware.hex")
        with open(hex_path, "w") as f:
            f.write(hex_data)

        session.state = SimulationState.STARTING
        await on_state_change(SimulationState.STARTING)

        try:
            # Run simavr in Docker container
            docker_cmd = [
                "docker", "run",
                "--rm",
                "-i",
                "--name", f"cubot_sim_{session_id[:12]}",
                "-v", f"{temp_dir}:/sim:ro",
                "--network", "none",
                "-m", "256m",
                "--cpus", "0.5",
                self.SIMULATOR_IMAGE,
                "/sim/firmware.hex",
            ]

            process = await asyncio.create_subprocess_exec(
                *docker_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            session.process = process
            session.state = SimulationState.RUNNING
            await on_state_change(SimulationState.RUNNING)

            # Read simulation output line by line
            async def read_output():
                try:
                    while process.stdout and not process.stdout.at_eof():
                        line = await process.stdout.readline()
                        if not line:
                            break

                        text = line.decode("utf-8", errors="replace").strip()
                        if not text:
                            continue

                        try:
                            msg = json.loads(text)
                        except json.JSONDecodeError:
                            # Plain text from simavr, treat as debug
                            continue

                        msg_type = msg.get("type")

                        if msg_type == "serial":
                            await on_serial(msg.get("data", ""))
                        elif msg_type == "pin":
                            pin = msg.get("pin", -1)
                            value = msg.get("value", False)
                            if 0 <= pin <= 13:
                                session.pin_states[pin] = value
                                await on_pin_change(pin, value)
                        elif msg_type == "ready":
                            # Simulation initialized
                            pass
                except asyncio.CancelledError:
                    pass
                except Exception:
                    session.state = SimulationState.ERROR
                    await on_state_change(SimulationState.ERROR)

            async def read_stderr():
                try:
                    while process.stderr and not process.stderr.at_eof():
                        line = await process.stderr.readline()
                        if not line:
                            break
                        # Log stderr but don't send to client
                        print(f"[simavr stderr] {line.decode('utf-8', errors='replace').strip()}")
                except asyncio.CancelledError:
                    pass

            # Run both readers concurrently
            await asyncio.gather(read_output(), read_stderr())

            # Process ended
            await process.wait()
            if session.state == SimulationState.RUNNING:
                session.state = SimulationState.STOPPED
                await on_state_change(SimulationState.STOPPED)

        except FileNotFoundError:
            session.state = SimulationState.ERROR
            await on_state_change(SimulationState.ERROR)
            raise RuntimeError("Docker is not available")
        except Exception:
            session.state = SimulationState.ERROR
            await on_state_change(SimulationState.ERROR)
            raise
        finally:
            # Cleanup
            if session.temp_dir and os.path.exists(session.temp_dir):
                shutil.rmtree(session.temp_dir, ignore_errors=True)

        return session

    async def stop_simulation(self, session_id: str) -> None:
        """Stop a running simulation."""
        session = self._sessions.get(session_id)
        if not session:
            return

        # Kill Docker container
        try:
            container_name = f"cubot_sim_{session_id[:12]}"
            proc = await asyncio.create_subprocess_exec(
                "docker", "stop", "-t", "2", container_name,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=5)
        except Exception:
            # Force kill if stop fails
            try:
                proc = await asyncio.create_subprocess_exec(
                    "docker", "kill", container_name,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(proc.wait(), timeout=3)
            except Exception:
                pass

        # Kill the process if still alive
        if session.process and session.process.returncode is None:
            try:
                session.process.terminate()
                await asyncio.wait_for(session.process.wait(), timeout=3)
            except Exception:
                session.process.kill()

        session.state = SimulationState.STOPPED

        # Cleanup temp dir
        if session.temp_dir and os.path.exists(session.temp_dir):
            shutil.rmtree(session.temp_dir, ignore_errors=True)

        del self._sessions[session_id]

    async def send_serial_input(self, session_id: str, data: str) -> bool:
        """Send serial input to a running simulation."""
        session = self._sessions.get(session_id)
        if not session or session.state != SimulationState.RUNNING:
            return False

        if session.process and session.process.stdin:
            try:
                msg = json.dumps({"type": "serial_input", "data": data}) + "\n"
                session.process.stdin.write(msg.encode())
                await session.process.stdin.drain()
                return True
            except Exception:
                return False
        return False

    def get_session(self, session_id: str) -> Optional[SimulationSession]:
        """Get a simulation session by ID."""
        return self._sessions.get(session_id)


simulation_service = SimulationService()
