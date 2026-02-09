from fastapi import APIRouter, HTTPException, status
from typing import List
from datetime import datetime
from bson import ObjectId

from core.database import get_collection
from schemas.blocks import (
    BlockProgramCreate,
    BlockProgramUpdate,
    BlockProgramResponse,
    ArmStateResponse,
)
from services.inverse_kinematics import ArmKinematics

router = APIRouter(tags=["blocks"])

# In-memory arm state (in production, this could be in Redis or database)
arm_state = {
    "position": {"x": 0, "y": 0, "z": 0},
    "joints": [0, 0, 0, 0, 0, 0],
    "is_moving": False,
}


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
        raise HTTPException(
            status_code=400, 
            detail=f"Position ({x}, {y}, {z}) is unreachable. Max reach: ~3.2 units"
        )
    
    # Solve inverse kinematics
    joint_angles = ArmKinematics.solve_ik(x, y, z)
    
    if joint_angles is None:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to solve IK for position ({x}, {y}, {z})"
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
    arm_state["position"] = {"x": x, "y": y, "z": z}
    arm_state["joints"] = joint_angles
    
    # Simulate gradual movement
    import asyncio
    await asyncio.sleep(movement_time)
    
    arm_state["is_moving"] = False
    
    return {
        "status": "success",
        "position": arm_state["position"],
        "joints": joint_angles,
        "movement_time": movement_time
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
    
    # Simulate gradual movement
    import asyncio
    await asyncio.sleep(movement_time)
    
    arm_state["is_moving"] = False
    
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
    
    return {"status": "success", "message": "Arm reset to home position"}
