"""
Tool function implementations for AI assistant
These functions are called when the AI decides to use a tool
"""

import logging
from typing import Dict, Any, Optional
from models.file import FileCreate, FileUpdate, FileType
from services.file_service import file_service

logger = logging.getLogger(__name__)


class FileOperationError(Exception):
    """Raised when a file operation fails"""
    pass


async def handle_tool_use(
    tool_name: str,
    tool_input: Dict[str, Any],
    project_id: str,
    workspace_id: Optional[str] = None,
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
        elif tool_name == "execute_in_sandbox":
            if not workspace_id:
                return {"success": False, "error": "No sandbox workspace available for this project."}
            return await tool_execute_in_sandbox(workspace_id, tool_input)
        elif tool_name == "search_web":
            logger.info(f"Tool call: search_web with query: {tool_input.get('query', '')}")
            return await tool_search_web(tool_input)
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
    Find a file by path, handling two storage conventions:
    - Old (full-path): path = "src/node.py", name = "node.py"
    - New (dir-only):  path = "src",         name = "node.py"
                       path = "",             name = "root.py"  (root-level)
    The agent always provides the full path (e.g. "src/node.py" or "test.py").
    """
    from core.database import get_collection
    from models.file import FileResponse

    # 1. Exact match (old convention: path stores full path including filename)
    existing = await file_service.get_file_by_path(project_id, path)
    if existing:
        return existing

    # 2. Dir + name lookup (new convention: path stores directory, name stores filename)
    if "/" in path:
        dir_part, name_part = path.rsplit("/", 1)
    else:
        dir_part = ""   # root-level file
        name_part = path

    collection = get_collection("files")
    doc = await collection.find_one({
        "project_id": project_id,
        "path": dir_part,
        "name": name_part,
    })
    if doc:
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
    
    # Separate directory and filename so storage is consistent with user-created files.
    # The model provides the full path (e.g. "src/node.py"); we store the directory
    # ("src") in `path` and the filename ("node.py") in `name`.
    if "/" in path:
        dir_path = path.rsplit("/", 1)[0]
        file_name = path.rsplit("/", 1)[1]
    else:
        dir_path = ""
        file_name = path

    # Create the file
    try:
        file = await file_service.create_file(
            FileCreate(
                project_id=project_id,
                name=file_name,
                path=dir_path,
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

    file = await _find_file(project_id, path)
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
        # Derive the directory from the stored path, handling both conventions:
        #   Convention A (dir-only):  path="src",           name="node.py"
        #   Convention B (full-path): path="src/node.py",   name="node.py"
        #   Root A:                   path="",              name="root.py"
        #   Root B:                   path="root.py",       name="root.py"
        raw = (f.path or "").strip("/")

        if not raw or raw == "." or raw == f.name:
            # Root-level file
            dir_part = ""
        elif raw.endswith("/" + f.name):
            # Full-path convention — strip filename to get directory
            dir_part = raw[: -(len(f.name) + 1)]
        else:
            # Directory-only convention
            dir_part = raw

        # The full path the model should use for create/update/read calls
        full_path = (dir_part + "/" + f.name) if dir_part else f.name

        file_list.append({
            "path": full_path,
            "name": f.name,
            "type": f.file_type,
            "size": len(f.content)
        })

        if dir_part:
            directories.add(dir_part)
        else:
            directories.add(".")

    # Return files plus a deduplicated list of directories to help the model
    dirs_sorted = sorted(list(directories))
    logger.debug(f"list_files directories: {dirs_sorted}")
    return {
        "success": True,
        "files": file_list,
        "directories": dirs_sorted,
        "count": len(file_list)
    }


async def tool_execute_in_sandbox(workspace_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool: Run a shell command inside the Daytona sandbox workspace.

    Args:
        workspace_id: Daytona workspace ID
        tool_input: Dictionary with 'command' and optional 'timeout'

    Returns:
        Dictionary with stdout, stderr, exit_code, and success flag
    """
    from services.daytona_service import daytona_service
    from schemas.daytona import CodeExecutionRequest

    command = tool_input.get("command", "").strip()
    timeout = min(int(tool_input.get("timeout", 60)), 120)

    if not command:
        return {"success": False, "error": "No command provided"}

    logger.info(f"execute_in_sandbox: workspace={workspace_id} command={command!r}")

    try:
        result = await daytona_service.execute_code(
            CodeExecutionRequest(
                workspace_id=workspace_id,
                code=command,
                timeout=timeout,
            )
        )
        logger.info(f"execute_in_sandbox exit_code={result.exit_code} time={result.execution_time:.2f}s")
        return {
            "success": result.success,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.exit_code,
            "execution_time": result.execution_time,
        }
    except Exception as e:
        logger.error(f"execute_in_sandbox failed: {str(e)}")
        return {"success": False, "error": str(e)}


async def tool_search_web(tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tool: Search the web using Exa for up-to-date technical information.
    """
    from core.config import settings

    query = tool_input.get("query", "").strip()
    num_results = min(int(tool_input.get("num_results", 5)), 10)

    if not query:
        logger.warning("search_web: No search query provided")
        return {"success": False, "error": "No search query provided"}

    if not settings.EXA_API_KEY:
        logger.error("search_web: EXA_API_KEY is not configured in environment")
        return {"success": False, "error": "EXA_API_KEY is not configured. Please set it in your .env file."}

    logger.info(f"search_web (Exa): query={query!r} num_results={num_results}")

    try:
        from exa_py import Exa

        exa = Exa(api_key=settings.EXA_API_KEY)
        response = exa.search(
            query=query,
            type="auto",
            num_results=num_results,
            contents={"highlights": {"max_characters": 2000}},
        )

        results = []
        for r in response.results:
            snippet = ""
            if hasattr(r, "highlights") and r.highlights:
                snippet = " ... ".join(r.highlights)
            results.append({
                "title": r.title or "",
                "url": r.url or "",
                "snippet": snippet,
            })

        logger.info(f"search_web found {len(results)} results")
        return {
            "success": True,
            "query": query,
            "results": results,
            "count": len(results),
        }

    except ImportError:
        return {"success": False, "error": "exa-py not installed. Run: pip install exa-py"}
    except Exception as e:
        logger.error(f"search_web failed: {str(e)}")
        return {"success": False, "error": str(e)}


