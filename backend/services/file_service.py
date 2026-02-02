from typing import List, Optional
from datetime import datetime
from bson import ObjectId

from core.database import get_collection
from models.file import FileCreate, FileUpdate, FileResponse, FileType


class FileService:
    """Service for managing files in MongoDB"""
    
    COLLECTION_NAME = "files"
    
    @staticmethod
    def _get_file_type(filename: str) -> FileType:
        """Determine file type from filename"""
        ext = filename.lower().split('.')[-1] if '.' in filename else ''
        type_map = {
            'c': FileType.C,
            'cpp': FileType.CPP,
            'cc': FileType.CPP,
            'h': FileType.H,
            'hpp': FileType.HPP,
            'ino': FileType.INO,
            'py': FileType.PY,
            'txt': FileType.TXT,
            'md': FileType.MD,
            'json': FileType.JSON,
        }
        if filename.lower() == 'makefile':
            return FileType.MAKEFILE
        return type_map.get(ext, FileType.OTHER)
    
    @classmethod
    async def create_file(
        cls,
        file_data: FileCreate,
        created_by: str = "user"
    ) -> FileResponse:
        """Create a new file"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        # Auto-detect file type if not provided
        file_type = file_data.file_type
        if file_type == FileType.OTHER:
            file_type = cls._get_file_type(file_data.name)
        
        doc = {
            "name": file_data.name,
            "path": file_data.path,
            "content": file_data.content,
            "file_type": file_type.value,
            "project_id": file_data.project_id,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "created_by": created_by,
        }
        
        result = await collection.insert_one(doc)
        doc["_id"] = str(result.inserted_id)
        
        return FileResponse(
            id=doc["_id"],
            name=doc["name"],
            path=doc["path"],
            content=doc["content"],
            file_type=doc["file_type"],
            project_id=doc["project_id"],
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            created_by=doc["created_by"],
        )
    
    @classmethod
    async def get_file(cls, file_id: str) -> Optional[FileResponse]:
        """Get a file by ID"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        doc = await collection.find_one({"_id": ObjectId(file_id)})
        if not doc:
            return None
        
        return FileResponse(
            id=str(doc["_id"]),
            name=doc["name"],
            path=doc["path"],
            content=doc["content"],
            file_type=doc["file_type"],
            project_id=doc["project_id"],
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            created_by=doc["created_by"],
        )
    
    @classmethod
    async def get_files_by_project(cls, project_id: str) -> List[FileResponse]:
        """Get all files in a project"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        cursor = collection.find({"project_id": project_id})
        files = []
        
        async for doc in cursor:
            files.append(FileResponse(
                id=str(doc["_id"]),
                name=doc["name"],
                path=doc["path"],
                content=doc["content"],
                file_type=doc["file_type"],
                project_id=doc["project_id"],
                created_at=doc["created_at"],
                updated_at=doc["updated_at"],
                created_by=doc["created_by"],
            ))
        
        return files
    
    @classmethod
    async def get_file_by_path(cls, project_id: str, path: str) -> Optional[FileResponse]:
        """Get a file by its path within a project"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        doc = await collection.find_one({
            "project_id": project_id,
            "path": path
        })
        
        if not doc:
            return None
        
        return FileResponse(
            id=str(doc["_id"]),
            name=doc["name"],
            path=doc["path"],
            content=doc["content"],
            file_type=doc["file_type"],
            project_id=doc["project_id"],
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            created_by=doc["created_by"],
        )
    
    @classmethod
    async def update_file(
        cls,
        file_id: str,
        file_update: FileUpdate
    ) -> Optional[FileResponse]:
        """Update a file"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        update_data = {k: v for k, v in file_update.model_dump().items() if v is not None}
        if not update_data:
            return await cls.get_file(file_id)
        
        # Update file type if name changed
        if "name" in update_data and "file_type" not in update_data:
            update_data["file_type"] = cls._get_file_type(update_data["name"]).value
        elif "file_type" in update_data:
            update_data["file_type"] = update_data["file_type"].value
        
        update_data["updated_at"] = datetime.utcnow()
        
        result = await collection.update_one(
            {"_id": ObjectId(file_id)},
            {"$set": update_data}
        )
        
        if result.modified_count == 0:
            return None
        
        return await cls.get_file(file_id)
    
    @classmethod
    async def delete_file(cls, file_id: str) -> bool:
        """Delete a file"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        result = await collection.delete_one({"_id": ObjectId(file_id)})
        return result.deleted_count > 0
    
    @classmethod
    async def delete_files_by_project(cls, project_id: str) -> int:
        """Delete all files in a project"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        result = await collection.delete_many({"project_id": project_id})
        return result.deleted_count
    
    @classmethod
    async def get_files_by_ids(cls, file_ids: List[str]) -> List[FileResponse]:
        """Get multiple files by their IDs"""
        collection = get_collection(cls.COLLECTION_NAME)
        
        object_ids = [ObjectId(fid) for fid in file_ids]
        cursor = collection.find({"_id": {"$in": object_ids}})
        files = []
        
        async for doc in cursor:
            files.append(FileResponse(
                id=str(doc["_id"]),
                name=doc["name"],
                path=doc["path"],
                content=doc["content"],
                file_type=doc["file_type"],
                project_id=doc["project_id"],
                created_at=doc["created_at"],
                updated_at=doc["updated_at"],
                created_by=doc["created_by"],
            ))
        
        return files


file_service = FileService()
