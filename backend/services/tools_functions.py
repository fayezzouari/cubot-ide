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
    logger.debug(f"Tool call - project: {project_id}, tool: {tool_name}, input keys: {list(tool_input.keys())}")
    
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
    finally:
        logger.debug(f"Completed tool invocation: {tool_name} for project {project_id}")


async def _find_file(project_id: str, path: str):
    """
    Find a file by path, handling both storage conventions:
    - Agent-created: path = full path (e.g. "src/node.py"), name = "node.py"
    - User-created:  path = directory  (e.g. "src"),         name = "node.py"
    """
    # Try exact match first
    existing = await file_service.get_file_by_path(project_id, path)
    if existing:
        return existing

    # If not found and path contains a slash, try dir+name split
    if "/" in path:
        dir_part, name_part = path.rsplit("/", 1)
        from core.database import get_collection
        collection = get_collection("files")
        doc = await collection.find_one({
            "project_id": project_id,
            "path": dir_part,
            "name": name_part,
        })
        if doc:
            from models.file import FileResponse
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
                origin=doc.get("origin"),
            )
    return None


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
    logger.info(f"create_file called for project {project_id}: path={path}")
    logger.debug(f"create_file content length: {len(content) if content is not None else 0}")

    # Check if file already exists (handles both storage conventions)
    existing = await _find_file(project_id, path)
    if existing:
        logger.info(f"create_file aborted: file already exists: {path} (id={existing.id})")
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
    try:
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
        logger.info(f"create_file succeeded: {path} (id={file.id})")
        logger.debug(f"create_file result path: {file.path}")
        return {
            "success": True,
            "file_id": file.id,
            "path": file.path,
            "message": f"Successfully created file: {path}"
        }
    except Exception as e:
        logger.error(f"create_file failed for {path}: {str(e)}")
        return {"success": False, "error": str(e)}


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
    logger.info(f"update_file called for project {project_id}: path={path}")
    logger.debug(f"update_file content length: {len(content) if content is not None else 0}")
    
    # Find the file (handles both storage conventions)
    existing = await _find_file(project_id, path)
    if not existing:
        logger.warning(f"update_file failed: file not found: {path}")
        return {
            "success": False,
            "error": f"File {path} not found. Use create_file to create it."
        }
    
    # Update the file
    try:
        updated = await file_service.update_file(
            existing.id,
            FileUpdate(content=content)
        )
        logger.info(f"update_file succeeded: {path} (id={updated.id})")
        return {
            "success": True,
            "file_id": updated.id,
            "path": updated.path,
            "message": f"Successfully updated file: {path}"
        }
    except Exception as e:
        logger.error(f"update_file failed for {path}: {str(e)}")
        return {"success": False, "error": str(e)}


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
    logger.info(f"read_file called for project {project_id}: path={path}")

    file = await file_service.get_file_by_path(project_id, path)
    if not file:
        logger.warning(f"read_file: file not found: {path}")
        return {
            "success": False,
            "error": f"File {path} not found"
        }

    logger.debug(f"read_file returning content length: {len(file.content) if file.content is not None else 0}")
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
    logger.info(f"list_files called for project {project_id}: found {len(files)} files")

    file_list = []
    directories = set()
    for f in files:
        # Build the full path the agent should use to reference this file.
        # User-created files store only the directory in f.path (e.g. "src"),
        # while agent-created files store the full path (e.g. "src/node.py").
        # We always expose the full path so the model can use it directly.
        raw_path = (f.path or "").strip("/")
        if raw_path and not raw_path.endswith(f.name):
            # raw_path is a directory — combine with filename
            full_path = raw_path + "/" + f.name
        elif raw_path:
            full_path = raw_path
        else:
            full_path = f.name

        file_list.append({
            "path": full_path,
            "name": f.name,
            "type": f.file_type,
            "size": len(f.content)
        })

        # Derive directory for the directories list
        if '/' in full_path:
            dirpath = full_path.rsplit('/', 1)[0]
            directories.add(dirpath)
        else:
            directories.add('.')

    # Return files plus a deduplicated list of directories to help the model
    dirs_sorted = sorted(list(directories))
    logger.debug(f"list_files directories: {dirs_sorted}")
    return {
        "success": True,
        "files": file_list,
        "directories": dirs_sorted,
        "count": len(file_list)
    }
