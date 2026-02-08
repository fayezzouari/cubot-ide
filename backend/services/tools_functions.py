"""
Tool function implementations for AI assistant
These functions are called when the AI decides to use a tool
"""

import logging
from typing import Dict, Any
from models.file import FileCreate, FileUpdate, FileType
from services.file_service import file_service

logger = logging.getLogger(__name__)


class FileOperationError(Exception):
    """Raised when a file operation fails"""
    pass


async def handle_tool_use(
    tool_name: str,
    tool_input: Dict[str, Any],
    project_id: str
) -> Dict[str, Any]:
    """
    Handle tool use requests from the model
    
    Args:
        tool_name: Name of the tool to execute
        tool_input: Input parameters for the tool
        project_id: Project ID for context
        
    Returns:
        Dictionary with tool execution result
    """
    logger.info(f"Handling tool use: {tool_name} with input: {tool_input}")
    
    try:
        if tool_name == "create_file":
            return await tool_create_file(project_id, tool_input)
        elif tool_name == "update_file":
            return await tool_update_file(project_id, tool_input)
        elif tool_name == "read_file":
            return await tool_read_file(project_id, tool_input)
        elif tool_name == "list_files":
            return await tool_list_files(project_id)
        else:
            raise FileOperationError(f"Unknown tool: {tool_name}")
    except Exception as e:
        logger.error(f"Tool execution error: {str(e)}")
        return {
            "error": str(e),
            "success": False
        }


async def tool_create_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool: Create a new file
    
    Args:
        project_id: Project ID
        tool_input: Dictionary with 'path' and 'content'
        
    Returns:
        Dictionary with success status and file info
    """
    path = tool_input.get("path")
    content = tool_input.get("content", "")
    
    # Check if file already exists
    existing = await file_service.get_file_by_path(project_id, path)
    if existing:
        return {
            "success": False,
            "error": f"File {path} already exists. Use update_file to modify it.",
            "file_id": existing.id
        }
    
    # Determine file type from extension
    ext = path.split(".")[-1].lower() if "." in path else ""
    file_type_map = {
        "c": FileType.C,
        "cpp": FileType.CPP,
        "h": FileType.H,
        "hpp": FileType.HPP,
        "ino": FileType.INO,
        "py": FileType.PY,
        "json": FileType.JSON,
        "md": FileType.MD,
        "txt": FileType.TXT,
    }
    file_type = file_type_map.get(ext, FileType.OTHER)
    
    # Create the file
    file = await file_service.create_file(
        FileCreate(
            project_id=project_id,
            name=path.split("/")[-1],
            path=path,
            content=content,
            file_type=file_type,
        ),
        created_by="agent"
    )
    
    return {
        "success": True,
        "file_id": file.id,
        "path": file.path,
        "message": f"Successfully created file: {path}"
    }


async def tool_update_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool: Update an existing file
    
    Args:
        project_id: Project ID
        tool_input: Dictionary with 'path' and 'content'
        
    Returns:
        Dictionary with success status and file info
    """
    path = tool_input.get("path")
    content = tool_input.get("content", "")
    
    # Find the file
    existing = await file_service.get_file_by_path(project_id, path)
    if not existing:
        return {
            "success": False,
            "error": f"File {path} not found. Use create_file to create it."
        }
    
    # Update the file
    updated = await file_service.update_file(
        existing.id,
        FileUpdate(content=content)
    )
    
    return {
        "success": True,
        "file_id": updated.id,
        "path": updated.path,
        "message": f"Successfully updated file: {path}"
    }


async def tool_read_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool: Read a file's content
    
    Args:
        project_id: Project ID
        tool_input: Dictionary with 'path'
        
    Returns:
        Dictionary with file content
    """
    path = tool_input.get("path")
    
    file = await file_service.get_file_by_path(project_id, path)
    if not file:
        return {
            "success": False,
            "error": f"File {path} not found"
        }
    
    return {
        "success": True,
        "path": file.path,
        "content": file.content,
        "file_type": file.file_type
    }


async def tool_list_files(project_id: str) -> Dict[str, Any]:
    """
    Tool: List all files in the project
    
    Args:
        project_id: Project ID
        
    Returns:
        Dictionary with list of files
    """
    files = await file_service.get_files_by_project(project_id)
    
    file_list = [
        {
            "path": f.path,
            "name": f.name,
            "type": f.file_type,
            "size": len(f.content)
        }
        for f in files
    ]
    
    return {
        "success": True,
        "files": file_list,
        "count": len(file_list)
    }
