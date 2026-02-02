from fastapi import APIRouter, HTTPException, status
from typing import List

from models.file import FileCreate, FileUpdate, FileResponse
from services.file_service import file_service

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def create_file(file_data: FileCreate):
    """Create a new file"""
    file = await file_service.create_file(file_data)
    return file


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(file_id: str):
    """Get a file by ID"""
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
    file = await file_service.update_file(file_id, file_update)
    if not file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )
    return file


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(file_id: str):
    """Delete a file"""
    deleted = await file_service.delete_file(file_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File with id {file_id} not found"
        )
    return None
