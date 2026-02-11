from typing import List, Optional
from datetime import datetime
from bson import ObjectId

from core.database import get_collection
from models.project import ProjectCreate, ProjectUpdate, ProjectResponse, ProjectWithFiles
from services.file_service import file_service


class ProjectService:
    """Service for managing projects in MongoDB"""
    
    COLLECTION_NAME = "projects"
    
    @classmethod
    async def create_project(cls, project_data: ProjectCreate) -> ProjectResponse:
        """Create a new project"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        doc = {
            "name": project_data.name,
            "description": project_data.description or "",
            "target_compiler": project_data.target_compiler.value,
            "project_type": project_data.project_type.value,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        
        result = await collection.insert_one(doc)
        doc["_id"] = str(result.inserted_id)
        
        return ProjectResponse(
            id=doc["_id"],
            name=doc["name"],
            description=doc["description"],
            target_compiler=doc["target_compiler"],
            project_type=doc["project_type"],
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            file_count=0,
        )
    
    @classmethod
    async def get_project(cls, project_id: str) -> Optional[ProjectResponse]:
        """Get a project by ID"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        doc = await collection.find_one({"_id": ObjectId(project_id)})
        if not doc:
            return None
        
        # Get file count
        files = await file_service.get_files_by_project(project_id)
        
        return ProjectResponse(
            id=str(doc["_id"]),
            name=doc["name"],
            description=doc.get("description", ""),
            target_compiler=doc["target_compiler"],
            project_type=doc.get("project_type", "embedded"),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            file_count=len(files),
        )
    
    @classmethod
    async def get_project_with_files(cls, project_id: str) -> Optional[ProjectWithFiles]:
        """Get a project with all its files"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        doc = await collection.find_one({"_id": ObjectId(project_id)})
        if not doc:
            return None
        
        files = await file_service.get_files_by_project(project_id)
        
        return ProjectWithFiles(
            id=str(doc["_id"]),
            name=doc["name"],
            description=doc.get("description", ""),
            target_compiler=doc["target_compiler"],
            project_type=doc.get("project_type", "embedded"),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            file_count=len(files),
            files=[f.model_dump() for f in files],
        )
    
    @classmethod
    async def get_all_projects(cls) -> List[ProjectResponse]:
        """Get all projects"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        cursor = collection.find({})
        projects = []
        
        async for doc in cursor:
            project_id = str(doc["_id"])
            files = await file_service.get_files_by_project(project_id)
            
            projects.append(ProjectResponse(
                id=project_id,
                name=doc["name"],
                description=doc.get("description", ""),
                target_compiler=doc["target_compiler"],
                project_type=doc.get("project_type", "embedded"),
                created_at=doc["created_at"],
                updated_at=doc["updated_at"],
                file_count=len(files),
            ))
        
        return projects
    
    @classmethod
    async def update_project(
        cls,
        project_id: str,
        project_update: ProjectUpdate
    ) -> Optional[ProjectResponse]:
        """Update a project"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        update_data = {k: v for k, v in project_update.model_dump().items() if v is not None}
        if not update_data:
            return await cls.get_project(project_id)
        
        if "target_compiler" in update_data:
            update_data["target_compiler"] = update_data["target_compiler"].value

        if "project_type" in update_data:
            update_data["project_type"] = update_data["project_type"].value
        
        update_data["updated_at"] = datetime.utcnow()
        
        result = await collection.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            return None
        
        return await cls.get_project(project_id)
    
    @classmethod
    async def delete_project(cls, project_id: str) -> bool:
        """Delete a project and all its files"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        # Delete all files first
        await file_service.delete_files_by_project(project_id)
        
        # Delete the project
        result = await collection.delete_one({"_id": ObjectId(project_id)})
        return result.deleted_count > 0


project_service = ProjectService()
