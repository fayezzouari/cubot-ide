from fastapi import APIRouter, HTTPException, status
from typing import List
import logging

from models.file import FileCreate, FileUpdate, FileResponse
from services.file_service import file_service
from bson import ObjectId
from services.daytona_service import daytona_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def create_file(file_data: FileCreate):
    """Create a new file"""
    file = await file_service.create_file(file_data)

    # Sync to Daytona sandbox
    try:
        # If the file originated from Daytona, don't re-sync back into the sandbox.
        if getattr(file_data, 'origin', None) != 'daytona':
            await daytona_service.sync_file_add(
                project_id=file.project_id,
                file_path=file.path,
                file_name=file.name,
                content=file.content
            )
    except Exception as e:
        logger.warning(f"Failed to sync file to Daytona: {e}")

    return file


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(file_id: str):
    """Get a file by ID"""
    # Validate ObjectId format early to avoid server error
    if not ObjectId.is_valid(file_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file id: {file_id}"
        )

    file = await file_service.get_file(file_id)
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )
    return file


@router.get("/project/{project_id}", response_model=List[FileResponse])
async def get_files_by_project(project_id: str):
    """Get all files for a project"""
    files = await file_service.get_files_by_project(project_id)
    return files


@router.get("/project/{project_id}/path/{path:path}", response_model=FileResponse)
async def get_file_by_path(project_id: str, path: str):
    """Get a file by its path within a project"""
    file = await file_service.get_file_by_path(project_id, path)
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File at path {path} not found in project"
        )
    return file


@router.put("/{file_id}", response_model=FileResponse)
async def update_file(file_id: str, file_update: FileUpdate):
    """Update a file"""
    # Validate ObjectId format early
    if not ObjectId.is_valid(file_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file id: {file_id}"
        )
    # Get the old file data to check for rename/move
    old_file = await file_service.get_file(file_id)
    if not old_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )

    # Update the file
    file = await file_service.update_file(file_id, file_update)
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )

    # Sync to Daytona sandbox
    try:
        # Check if it's a rename/move operation
        name_changed = file_update.name is not None and file_update.name != old_file.name
        path_changed = file_update.path is not None and file_update.path != old_file.path

        if name_changed or path_changed:
            # Handle rename/move
            await daytona_service.sync_file_rename(
                project_id=file.project_id,
                old_path=old_file.path,
                old_name=old_file.name,
                new_path=file.path,
                new_name=file.name
            )
        elif file_update.content is not None:
            # Handle content update
            await daytona_service.sync_file_update(
                project_id=file.project_id,
                file_path=file.path,
                file_name=file.name,
                content=file.content
            )
    except Exception as e:
        logger.warning(f"Failed to sync file update to Daytona: {e}")

    return file


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: str):
    """Delete a file"""
    logger.info(f"Attempting to delete file with id {file_id}")
    # Validate ObjectId format early
    if not ObjectId.is_valid(file_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file id: {file_id}"
        )
    # Get the file data before deletion for Daytona sync
    file = await file_service.get_file(file_id)
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )

    # Delete from database
    deleted = await file_service.delete_file(file_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )

    # Sync deletion to Daytona sandbox
    try:
        await daytona_service.sync_file_delete(
            project_id=file.project_id,
            file_path=file.path,
            file_name=file.name
        )
    except Exception as e:
        logger.warning(f"Failed to sync file deletion to Daytona: {e}")

    return None
