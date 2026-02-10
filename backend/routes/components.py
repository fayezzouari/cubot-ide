"""
API routes for custom components (sensors/actuators)
"""
from fastapi import APIRouter, HTTPException, status
from typing import List
from datetime import datetime
from bson import ObjectId

from core.database import get_collection
from schemas.components import (
    ComponentCreate,
    ComponentUpdate,
    ComponentResponse,
    ComponentType,
)

router = APIRouter(tags=["components"])


def component_helper(component) -> dict:
    """Convert MongoDB document to dict"""
    return {
        "id": str(component["_id"]),
        "user_id": component["user_id"],
        "name": component["name"],
        "component_type": component["component_type"],
        "description": component.get("description"),
        "pins": component["pins"],
        "script": component["script"],
        "icon": component.get("icon"),
        "properties": component.get("properties", {}),
        "created_at": component["created_at"].isoformat(),
        "updated_at": component["updated_at"].isoformat(),
    }


@router.post("/components", response_model=ComponentResponse, status_code=status.HTTP_201_CREATED)
async def create_component(component: ComponentCreate, user_id: str = "default"):
    """Create a new custom component"""
    collection = get_collection("components")
    
    component_dict = component.model_dump()
    component_dict["user_id"] = user_id
    component_dict["created_at"] = datetime.utcnow()
    component_dict["updated_at"] = datetime.utcnow()
    
    result = await collection.insert_one(component_dict)
    
    new_component = await collection.find_one({"_id": result.inserted_id})
    return component_helper(new_component)


@router.get("/components", response_model=List[ComponentResponse])
async def get_components(
    user_id: str = "default",
    component_type: ComponentType = None
):
    """Get all components for a user"""
    collection = get_collection("components")
    
    query = {"user_id": user_id}
    if component_type:
        query["component_type"] = component_type
    
    components = []
    async for component in collection.find(query):
        components.append(component_helper(component))
    
    return components


@router.get("/components/{component_id}", response_model=ComponentResponse)
async def get_component(component_id: str):
    """Get a specific component by ID"""
    collection = get_collection("components")
    
    try:
        component = await collection.find_one({"_id": ObjectId(component_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid component ID format")
    
    if not component:
        raise HTTPException(status_code=404, detail="Component not found")
    
    return component_helper(component)


@router.put("/components/{component_id}", response_model=ComponentResponse)
async def update_component(component_id: str, component_update: ComponentUpdate):
    """Update a component"""
    collection = get_collection("components")
    
    try:
        obj_id = ObjectId(component_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid component ID format")
    
    existing_component = await collection.find_one({"_id": obj_id})
    if not existing_component:
        raise HTTPException(status_code=404, detail="Component not found")
    
    update_data = {k: v for k, v in component_update.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    
    await collection.update_one({"_id": obj_id}, {"$set": update_data})
    
    updated_component = await collection.find_one({"_id": obj_id})
    return component_helper(updated_component)


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_component(component_id: str):
    """Delete a component"""
    collection = get_collection("components")
    
    try:
        obj_id = ObjectId(component_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid component ID format")
    
    result = await collection.delete_one({"_id": obj_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Component not found")
    
    return None
