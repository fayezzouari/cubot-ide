from fastapi import APIRouter, HTTPException, status
from typing import List

from models.project import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectWithFiles
from services.project_service import project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(project_data: ProjectCreate):
    """Create a new project"""
    project = await project_service.create_project(project_data)
    return project


@router.get("/", response_model=List[ProjectResponse])
async def get_all_projects():
    """Get all projects"""
    projects = await project_service.get_all_projects()
    return projects


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    """Get a project by ID"""
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found"
        )
    return project


@router.get("/{project_id}/with-files", response_model=ProjectWithFiles)
async def get_project_with_files(project_id: str):
    """Get a project with all its files"""
    project = await project_service.get_project_with_files(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found"
        )
    return project


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, project_update: ProjectUpdate):
    """Update a project"""
    project = await project_service.update_project(project_id, project_update)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found"
        )
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str):
    """Delete a project and all its files"""
    deleted = await project_service.delete_project(project_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found"
        )
    return None
