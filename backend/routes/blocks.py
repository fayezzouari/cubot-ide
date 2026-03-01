from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from typing import List
from datetime import datetime
from bson import ObjectId
import asyncio
import json
import math

from core.database import get_collection
from schemas.blocks import (
    BlockProgramCreate,
    BlockProgramUpdate,
    BlockProgramResponse,
    ArmStateResponse,
)
from services.inverse_kinematics import ArmKinematics

router = APIRouter(tags=["blocks"])
arm_ws_router = APIRouter(tags=["blocks-ws"])

# In-memory arm state (in production, this could be in Redis or database)
arm_state = {
    "position": {"x": 0, "y": 0, "z": 0},
    "joints": [0, 0, 0, 0, 0, 0],
    "is_moving": False,
}

# Connected WebSocket clients for arm status streaming
_arm_ws_clients: set[asyncio.Queue] = set()


async def _broadcast_arm_state():
    """Push current arm_state to all connected WebSocket clients."""
    if not _arm_ws_clients:
        return
    msg = json.dumps(arm_state)
    for q in list(_arm_ws_clients):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            pass


@arm_ws_router.websocket("/ws/arm/status")
async def arm_status_ws(websocket: WebSocket):
    """Stream real-time arm state to the client while a program is running."""
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    _arm_ws_clients.add(queue)
    try:
        # Send current state immediately on connect
        await websocket.send_text(json.dumps(arm_state))
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                # Send a ping-style keepalive so the connection doesn't idle-close
                await websocket.send_text(json.dumps(arm_state))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _arm_ws_clients.discard(queue)


def block_program_helper(program) -> dict:
    """Convert MongoDB document to dict"""
    return {
        "id": str(program["_id"]),
        "project_id": program["project_id"],
        "name": program["name"],
        "nodes": program["nodes"],
        "edges": program["edges"],
        "created_at": program["created_at"].isoformat(),
        "updated_at": program["updated_at"].isoformat(),
    }


@router.post("/blocks/programs", response_model=BlockProgramResponse, status_code=status.HTTP_201_CREATED)
async def create_block_program(program: BlockProgramCreate):
    """Create a new block program"""
    collection = get_collection("block_programs")
    
    program_dict = program.model_dump()
    program_dict["created_at"] = datetime.utcnow()
    program_dict["updated_at"] = datetime.utcnow()
    
    result = await collection.insert_one(program_dict)
    
    new_program = await collection.find_one({"_id": result.inserted_id})
    return block_program_helper(new_program)


@router.get("/blocks/programs", response_model=List[BlockProgramResponse])
async def get_block_programs(project_id: str = None):
    """Get all block programs, optionally filtered by project_id"""
    collection = get_collection("block_programs")
    
    query = {}
    if project_id:
        query["project_id"] = project_id
    
    programs = []
    async for program in collection.find(query):
        programs.append(block_program_helper(program))
    
    return programs


@router.get("/blocks/programs/{program_id}", response_model=BlockProgramResponse)
async def get_block_program(program_id: str):
    """Get a specific block program by ID"""
    collection = get_collection("block_programs")
    
    try:
        program = await collection.find_one({"_id": ObjectId(program_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid program ID format")
    
    if not program:
        raise HTTPException(status_code=404, detail="Block program not found")
    
    return block_program_helper(program)


@router.put("/blocks/programs/{program_id}", response_model=BlockProgramResponse)
async def update_block_program(program_id: str, program_update: BlockProgramUpdate):
    """Update a block program"""
    collection = get_collection("block_programs")
    
    try:
        obj_id = ObjectId(program_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid program ID format")
    
    # Check if program exists
    existing_program = await collection.find_one({"_id": obj_id})
    if not existing_program:
        raise HTTPException(status_code=404, detail="Block program not found")
    
    # Update only provided fields
    update_data = {k: v for k, v in program_update.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    
    await collection.update_one({"_id": obj_id}, {"$set": update_data})
    
    updated_program = await collection.find_one({"_id": obj_id})
    return block_program_helper(updated_program)


@router.delete("/blocks/programs/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block_program(program_id: str):
    """Delete a block program"""
    collection = get_collection("block_programs")
    
    try:
        obj_id = ObjectId(program_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid program ID format")
    
    result = await collection.delete_one({"_id": obj_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Block program not found")
    
    return None


@router.get("/blocks/arm/state", response_model=ArmStateResponse)
async def get_arm_state():
    """Get current arm state"""
    return arm_state


@router.post("/blocks/arm/move-position")
async def move_arm_position(x: float, y: float, z: float):
    """Move arm to a specific position using inverse kinematics"""
    global arm_state
    
    # Check if position is reachable
    if not ArmKinematics.is_reachable(x, y, z):
        # Calculate some helpful info
        horizontal_dist = math.sqrt(x**2 + z**2)
        shoulder_height = 0.8
        max_reach = 3.5
        
        reasons = []
        if y < 0.5:
            reasons.append("position is too low (minimum Y: 0.5)")
        if horizontal_dist < 0.5 and y < shoulder_height:
            reasons.append("position is inside the base")
        
        reach_dist = math.sqrt(horizontal_dist**2 + (y - shoulder_height)**2)
        if reach_dist > max_reach:
            reasons.append(f"position is too far (distance: {reach_dist:.2f}, max: {max_reach:.2f})")
        
        reason_str = "; ".join(reasons) if reasons else "position is unreachable"
        
        raise HTTPException(
            status_code=400, 
            detail=f"Position ({x}, {y}, {z}) is unreachable: {reason_str}"
        )
    
    # Solve inverse kinematics
    joint_angles = ArmKinematics.solve_ik(x, y, z)
    
    if joint_angles is None:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to solve IK for position ({x}, {y}, {z})"
        )
    
    # Verify the solution using forward kinematics
    actual_x, actual_y, actual_z = ArmKinematics.forward_kinematics(joint_angles)
    position_error = (
        (actual_x - x) ** 2 +
        (actual_y - y) ** 2 +
        (actual_z - z) ** 2
    ) ** 0.5
    
    # If error is too large, reject the solution
    if position_error > 0.15:  # 15cm tolerance (improved IK should be < 0.1)
        raise HTTPException(
            status_code=500,
            detail=f"IK solution verification failed. Target: ({x}, {y}, {z}), "
                   f"Actual: ({actual_x:.3f}, {actual_y:.3f}, {actual_z:.3f}), "
                   f"Error: {position_error:.3f} units"
        )
    
    # Calculate distance for movement time simulation
    current_pos = arm_state["position"]
    distance = (
        (x - current_pos["x"]) ** 2 +
        (y - current_pos["y"]) ** 2 +
        (z - current_pos["z"]) ** 2
    ) ** 0.5
    
    # Simulate movement time (0.5 seconds per unit of distance, minimum 0.5s)
    movement_time = max(0.5, distance * 0.5)
    
    arm_state["is_moving"] = True
    # Store the actual achieved position (from FK) instead of assuming target
    arm_state["position"] = {"x": actual_x, "y": actual_y, "z": actual_z}
    arm_state["joints"] = joint_angles
    await _broadcast_arm_state()

    # Simulate gradual movement
    await asyncio.sleep(movement_time)

    arm_state["is_moving"] = False
    await _broadcast_arm_state()
    
    return {
        "status": "success",
        "position": arm_state["position"],
        "joints": joint_angles,
        "movement_time": movement_time,
        "position_error": position_error
    }


@router.post("/blocks/arm/move-joint")
async def move_arm_joint(joint: int, angle: float):
    """Move a specific joint to an angle"""
    global arm_state
    
    if joint < 1 or joint > 6:
        raise HTTPException(status_code=400, detail="Joint must be between 1 and 6")
    
    # Calculate angle difference for movement time simulation
    current_angle = arm_state["joints"][joint - 1]
    angle_diff = abs(angle - current_angle)
    
    # Simulate movement time (0.01 seconds per degree, minimum 0.3s)
    movement_time = max(0.3, angle_diff * 0.01)
    
    arm_state["is_moving"] = True
    arm_state["joints"][joint - 1] = angle
    await _broadcast_arm_state()

    # Simulate gradual movement
    await asyncio.sleep(movement_time)

    arm_state["is_moving"] = False
    await _broadcast_arm_state()
    
    return {
        "status": "success",
        "joint": joint,
        "angle": angle,
        "movement_time": movement_time
    }


@router.post("/blocks/arm/reset")
async def reset_arm():
    """Reset arm to home position"""
    global arm_state
    
    arm_state["position"] = {"x": 0, "y": 0, "z": 0}
    arm_state["joints"] = [0, 0, 0, 0, 0, 0]
    arm_state["is_moving"] = False
    await _broadcast_arm_state()

    return {"status": "success", "message": "Arm reset to home position"}
