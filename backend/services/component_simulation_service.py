"""
Component Simulation Service

Manages simulation of custom sensors and actuators with user-defined scripts.
Integrates with Daytona for sandboxed execution.
"""
import asyncio
import json
import logging
from typing import Dict, Any, Optional, Callable
from datetime import datetime

from schemas.components import (
    SimulationComponentInstance,
    SimulationConfig,
    ComponentResponse,
)
from services.daytona_service import daytona_service
from schemas.daytona import CodeExecutionRequest

logger = logging.getLogger(__name__)


class ComponentSimulationService:
    """
    Manages simulation of custom components with Arduino code.
    
    Features:
    - Execute user-defined sensor/actuator scripts in sandboxed environment
    - Simulate pin interactions between Arduino and components
    - Real-time state updates and visualization
    - Wiring validation
    """
    
    def __init__(self):
        self._active_simulations: Dict[str, 'SimulationSession'] = {}
    
    async def start_simulation(
        self,
        session_id: str,
        config: SimulationConfig,
        components_library: Dict[str, ComponentResponse],
        workspace_id: str,
        on_component_update: Callable[[str, Dict[str, Any]], Any],
        on_pin_change: Callable[[str, str, Any], Any],
        on_serial: Callable[[str], Any],
    ) -> 'SimulationSession':
        """
        Start a new component simulation.
        
        Args:
            session_id: Unique simulation identifier
            config: Simulation configuration
            components_library: Available component definitions
            workspace_id: Daytona workspace ID for code execution
            on_component_update: Callback for component state changes
            on_pin_change: Callback for pin state changes
            on_serial: Callback for serial output
            
        Returns:
            Active simulation session
        """
        # Stop existing simulation if any
        if session_id in self._active_simulations:
            await self.stop_simulation(session_id)
        
        session = SimulationSession(
            session_id=session_id,
            config=config,
            components_library=components_library,
            workspace_id=workspace_id,
            on_component_update=on_component_update,
            on_pin_change=on_pin_change,
            on_serial=on_serial,
        )
        
        self._active_simulations[session_id] = session
        
        # Initialize component states
        for instance in config.components:
            component_def = components_library.get(instance.component_id)
            if component_def:
                session.component_states[instance.instance_id] = {
                    "initialized": False,
                    "data": {},
                    "pins": {pin.name: pin.default_value for pin in component_def.pins},
                }
        
        # Start simulation loop
        session.task = asyncio.create_task(self._simulation_loop(session))
        
        return session
    
    async def _simulation_loop(self, session: 'SimulationSession'):
        """Main simulation loop"""
        try:
            # Initialize all components
            for instance in session.config.components:
                await self._initialize_component(session, instance)
            
            # Simulation tick loop (runs at ~10Hz)
            tick = 0
            while session.running:
                # Update all components
                for instance in session.config.components:
                    await self._update_component(session, instance, tick)
                
                # Check for duration limit
                if session.config.duration and tick / 10 >= session.config.duration:
                    break
                
                tick += 1
                await asyncio.sleep(0.1)  # 100ms per tick
                
        except asyncio.CancelledError:
            logger.info(f"Simulation {session.session_id} cancelled")
        except Exception as e:
            logger.error(f"Simulation error: {e}", exc_info=True)
        finally:
            session.running = False
    
    async def _initialize_component(
        self,
        session: 'SimulationSession',
        instance: SimulationComponentInstance
    ):
        """Initialize a component by calling its init function"""
        component_def = session.components_library.get(instance.component_id)
        if not component_def:
            logger.warning(f"Component {instance.component_id} not found")
            return
        
        # Prepare initialization context
        context = {
            "instance_id": instance.instance_id,
            "pins": instance.pin_connections,
            "properties": component_def.properties,
            "state": session.component_states[instance.instance_id]["data"],
        }
        
        # Execute init script
        init_code = self._wrap_component_code(
            component_def.script.code,
            "init",
            context
        )
        
        result = await self._execute_component_code(
            session.workspace_id,
            init_code,
            component_def.script.language
        )
        
        if result.success:
            # Update component state from init
            try:
                output = json.loads(result.stdout) if result.stdout else {}
                session.component_states[instance.instance_id]["data"].update(
                    output.get("state", {})
                )
                session.component_states[instance.instance_id]["initialized"] = True
                
                await session.on_component_update(
                    instance.instance_id,
                    session.component_states[instance.instance_id]["data"]
                )
            except json.JSONDecodeError:
                logger.warning(f"Component init output not JSON: {result.stdout}")
        else:
            logger.error(f"Component init failed: {result.stderr}")
    
    async def _update_component(
        self,
        session: 'SimulationSession',
        instance: SimulationComponentInstance,
        tick: int
    ):
        """Update component state for one simulation tick"""
        component_def = session.components_library.get(instance.component_id)
        if not component_def:
            return
        
        state = session.component_states.get(instance.instance_id)
        if not state or not state["initialized"]:
            return
        
        # Read current pin values from Arduino simulation
        pin_values = {}
        for pin_name, arduino_pin in instance.pin_connections.items():
            pin_values[pin_name] = session.arduino_pin_states.get(arduino_pin, 0)
        
        # Prepare update context
        context = {
            "instance_id": instance.instance_id,
            "tick": tick,
            "time": tick * 0.1,  # seconds
            "pins": instance.pin_connections,
            "pin_values": pin_values,
            "state": state["data"],
            "properties": component_def.properties,
        }
        
        # Execute update script
        update_code = self._wrap_component_code(
            component_def.script.code,
            "update",
            context
        )
        
        result = await self._execute_component_code(
            session.workspace_id,
            update_code,
            component_def.script.language,
            timeout=5
        )
        
        if result.success and result.stdout:
            try:
                output = json.loads(result.stdout)
                
                # Update component state
                if "state" in output:
                    state["data"].update(output["state"])
                    await session.on_component_update(
                        instance.instance_id,
                        state["data"]
                    )
                
                # Update pin outputs
                if "pin_outputs" in output:
                    for pin_name, value in output["pin_outputs"].items():
                        arduino_pin = instance.pin_connections.get(pin_name)
                        if arduino_pin:
                            session.arduino_pin_states[arduino_pin] = value
                            await session.on_pin_change(
                                instance.instance_id,
                                arduino_pin,
                                value
                            )
                
                # Serial output
                if "serial" in output:
                    await session.on_serial(output["serial"])
                    
            except json.JSONDecodeError:
                logger.warning(f"Component update output not JSON: {result.stdout}")
    
    def _wrap_component_code(
        self,
        user_code: str,
        function_name: str,
        context: Dict[str, Any]
    ) -> str:
        """Wrap user code with context and execution harness"""
        context_json = json.dumps(context)
        
        # Python wrapper
        wrapper = f"""
import json
import sys

# User code
{user_code}

# Execution
if __name__ == "__main__":
    context = json.loads('''{context_json}''')
    
    try:
        if '{function_name}' == 'init' and 'init' in dir():
            result = init(context)
        elif '{function_name}' == 'update' and 'update' in dir():
            result = update(context)
        else:
            result = {{"error": "Function {function_name} not found"}}
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({{"error": str(e)}}), file=sys.stderr)
        sys.exit(1)
"""
        return wrapper
    
    async def _execute_component_code(
        self,
        workspace_id: str,
        code: str,
        language: str,
        timeout: int = 10
    ) -> Any:
        """Execute component code in Daytona workspace"""
        request = CodeExecutionRequest(
            workspace_id=workspace_id,
            code=code,
            language=language,
            timeout=timeout,
        )
        
        return await daytona_service.execute_code(request)
    
    async def set_arduino_pin(
        self,
        session_id: str,
        pin: str,
        value: Any
    ):
        """Set Arduino pin value (from Arduino code simulation)"""
        session = self._active_simulations.get(session_id)
        if session:
            session.arduino_pin_states[pin] = value
    
    async def stop_simulation(self, session_id: str):
        """Stop a running simulation"""
        session = self._active_simulations.get(session_id)
        if session:
            session.running = False
            if session.task:
                session.task.cancel()
                try:
                    await session.task
                except asyncio.CancelledError:
                    pass
            del self._active_simulations[session_id]
    
    def get_session(self, session_id: str) -> Optional['SimulationSession']:
        """Get active simulation session"""
        return self._active_simulations.get(session_id)


class SimulationSession:
    """Tracks an active component simulation"""
    
    def __init__(
        self,
        session_id: str,
        config: SimulationConfig,
        components_library: Dict[str, ComponentResponse],
        workspace_id: str,
        on_component_update: Callable,
        on_pin_change: Callable,
        on_serial: Callable,
    ):
        self.session_id = session_id
        self.config = config
        self.components_library = components_library
        self.workspace_id = workspace_id
        self.on_component_update = on_component_update
        self.on_pin_change = on_pin_change
        self.on_serial = on_serial
        
        self.running = True
        self.task: Optional[asyncio.Task] = None
        self.component_states: Dict[str, Dict[str, Any]] = {}
        self.arduino_pin_states: Dict[str, Any] = {}
        self.created_at = datetime.utcnow()


component_simulation_service = ComponentSimulationService()
