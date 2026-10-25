"""
Tool implementations for the IDE coding agent.

Each tool returns a plain dict. File-changing tools also return `previous_content`
(so the client can revert) and line-level diff counts (so the client can show
"+12 −3"); the model never sees `previous_content`, see `result_for_model`.
"""

import difflib
import logging
from typing import Any, Dict, Optional

from models.file import FileCreate, FileUpdate, FileType
from services.file_service import file_service

logger = logging.getLogger(__name__)

# Fields that exist for the client only; stripped before a result goes back to the model.
CLIENT_ONLY_FIELDS = ("previous_content",)

# Output caps so one noisy tool call can't blow the context window.
MAX_TOOL_OUTPUT_CHARS = 6000
MAX_COMPILE_ERRORS = 25


class FileOperationError(Exception):
    """Raised when a file operation fails"""


def result_for_model(result: Dict[str, Any]) -> Dict[str, Any]:
    """Drop client-only fields before serialising a tool result for the model."""
    return {k: v for k, v in result.items() if k not in CLIENT_ONLY_FIELDS}


def diff_stats(old: str, new: str) -> Dict[str, int]:
    """Count added and removed lines between two versions of a file."""
    added = removed = 0
    for line in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0):
        if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            added += 1
        elif line.startswith("-"):
            removed += 1
    return {"added": added, "removed": removed}


def _tail(text: str, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return "…[truncated]…\n" + text[-limit:]


async def handle_tool_use(
    tool_name: str,
    tool_input: Dict[str, Any],
    project_id: str,
    workspace_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatch one tool call from the model."""
    logger.info("tool %s input keys=%s project=%s", tool_name, list(tool_input.keys()), project_id)

    try:
        if tool_name == "create_file":
            return await tool_create_file(project_id, tool_input)
        if tool_name == "edit_file":
            return await tool_edit_file(project_id, tool_input)
        if tool_name == "update_file":
            return await tool_update_file(project_id, tool_input)
        if tool_name == "read_file":
            return await tool_read_file(project_id, tool_input)
        if tool_name == "list_files":
            return await tool_list_files(project_id)
        if tool_name == "compile_project":
            return await tool_compile_project(project_id, tool_input)
        if tool_name == "execute_in_sandbox":
            if not workspace_id:
                return {"success": False, "error": "No sandbox workspace available for this project."}
            return await tool_execute_in_sandbox(workspace_id, tool_input)
        if tool_name == "search_web":
            return await tool_search_web(tool_input)
        raise FileOperationError(f"Unknown tool: {tool_name}")
    except Exception as e:
        logger.error("tool %s failed: %s", tool_name, e)
        return {"error": str(e), "success": False}


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

    path = (path or "").strip().lstrip("/")
    existing = await file_service.get_file_by_path(project_id, path)
    if existing:
        return existing

    if "/" in path:
        dir_part, name_part = path.rsplit("/", 1)
    else:
        dir_part, name_part = "", path

    collection = get_collection("files")
    dir_paths = [dir_part] if dir_part else ["", "/", "."]
    doc = await collection.find_one({"project_id": project_id, "path": {"$in": dir_paths}, "name": name_part})
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


def _full_path(f) -> str:
    """Full path the model should use, whichever storage convention the file uses."""
    raw = (f.path or "").strip("/")
    if not raw or raw == "." or raw == f.name:
        return f.name
    if raw.endswith("/" + f.name):
        return raw
    return f"{raw}/{f.name}"


async def tool_create_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    path = (tool_input.get("path") or "").strip().lstrip("/")
    content = tool_input.get("content") or ""
    if not path:
        return {"success": False, "error": "create_file needs a path."}

    existing = await _find_file(project_id, path)
    if existing:
        return {
            "success": False,
            "error": f"File {path} already exists. Use edit_file or update_file to modify it.",
            "file_id": existing.id,
        }

    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    file_type_map = {
        "c": FileType.C, "cpp": FileType.CPP, "h": FileType.H, "hpp": FileType.HPP,
        "ino": FileType.INO, "py": FileType.PY, "json": FileType.JSON, "md": FileType.MD, "txt": FileType.TXT,
    }
    file_type = file_type_map.get(ext, FileType.OTHER)

    if "/" in path:
        dir_path, file_name = path.rsplit("/", 1)
    else:
        dir_path, file_name = "", path

    try:
        file = await file_service.create_file(
            FileCreate(project_id=project_id, name=file_name, path=dir_path, content=content, file_type=file_type),
            created_by="agent",
        )
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": True,
        "operation": "create_file",
        "file_id": file.id,
        "path": path,
        "summary": tool_input.get("summary") or f"Created {path}",
        "added": len(content.splitlines()),
        "removed": 0,
        "previous_content": None,
        "message": f"Created {path}",
    }


async def tool_update_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    path = (tool_input.get("path") or "").strip().lstrip("/")
    content = tool_input.get("content") or ""

    existing = await _find_file(project_id, path)
    if not existing:
        return {"success": False, "error": f"File {path} not found. Use create_file to create it."}

    if existing.content == content:
        return {
            "success": True,
            "operation": "update_file",
            "file_id": existing.id,
            "path": path,
            "summary": "No change: the new content is identical to the current file.",
            "added": 0,
            "removed": 0,
            "previous_content": existing.content,
            "message": f"{path} unchanged",
        }

    try:
        await file_service.update_file(existing.id, FileUpdate(content=content))
    except Exception as e:
        return {"success": False, "error": str(e)}

    stats = diff_stats(existing.content, content)
    return {
        "success": True,
        "operation": "update_file",
        "file_id": existing.id,
        "path": path,
        "summary": tool_input.get("summary") or f"Rewrote {path}",
        **stats,
        "previous_content": existing.content,
        "message": f"Updated {path} (+{stats['added']} −{stats['removed']})",
    }


async def tool_edit_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """Replace one exact span. Refuses ambiguous or missing matches so edits never land in the wrong place."""
    path = (tool_input.get("path") or "").strip().lstrip("/")
    old_text = tool_input.get("old_text")
    new_text = tool_input.get("new_text")
    if old_text is None or new_text is None:
        return {"success": False, "error": "edit_file needs old_text and new_text."}
    if old_text == "":
        return {"success": False, "error": "old_text is empty. Use create_file or update_file to add content."}

    existing = await _find_file(project_id, path)
    if not existing:
        return {"success": False, "error": f"File {path} not found. Call list_files to see the available paths."}

    current = existing.content or ""
    count = current.count(old_text)
    if count == 0:
        # Second chance: the model often normalises indentation. Try a whitespace-insensitive line match.
        relaxed = _relaxed_find(current, old_text)
        if relaxed is None:
            return {
                "success": False,
                "error": (
                    f"old_text was not found in {path}. Read the file and copy the exact text, "
                    "including indentation."
                ),
            }
        start, end = relaxed
        updated = current[:start] + new_text + current[end:]
    elif count > 1:
        return {
            "success": False,
            "error": f"old_text matches {count} places in {path}. Include more surrounding lines so it is unique.",
        }
    else:
        updated = current.replace(old_text, new_text, 1)

    if updated == current:
        return {
            "success": True,
            "operation": "edit_file",
            "file_id": existing.id,
            "path": path,
            "summary": "No change: replacement is identical to the existing text.",
            "added": 0,
            "removed": 0,
            "previous_content": current,
            "message": f"{path} unchanged",
        }

    try:
        await file_service.update_file(existing.id, FileUpdate(content=updated))
    except Exception as e:
        return {"success": False, "error": str(e)}

    stats = diff_stats(current, updated)
    return {
        "success": True,
        "operation": "edit_file",
        "file_id": existing.id,
        "path": path,
        "summary": tool_input.get("summary") or f"Edited {path}",
        **stats,
        "previous_content": current,
        "message": f"Edited {path} (+{stats['added']} −{stats['removed']})",
        **_after_edit(updated),
    }


MAX_ECHO_LINES = 300


def _after_edit(content: str) -> Dict[str, Any]:
    """Echo the file after an edit so the model re-reads it and catches what it missed."""
    lines = content.splitlines()
    if len(lines) > MAX_ECHO_LINES:
        return {"note": f"File now has {len(lines)} lines; call read_file to review it."}
    return {"content_after_edit": content, "note": "Review the whole file above for remaining problems."}


def _relaxed_find(haystack: str, needle: str) -> Optional[tuple[int, int]]:
    """
    Locate `needle` in `haystack` comparing lines with leading/trailing whitespace stripped.
    Returns the (start, end) character span of the match in `haystack`, or None.
    Only accepts a unique match.
    """
    needle_lines = [ln.strip() for ln in needle.strip("\n").splitlines()]
    if not needle_lines:
        return None
    hay_lines = haystack.splitlines(keepends=True)
    stripped = [ln.strip() for ln in hay_lines]
    n = len(needle_lines)
    matches = [i for i in range(len(stripped) - n + 1) if stripped[i:i + n] == needle_lines]
    if len(matches) != 1:
        return None
    i = matches[0]
    start = sum(len(ln) for ln in hay_lines[:i])
    end = start + sum(len(ln) for ln in hay_lines[i:i + n])
    # When the model omitted the indentation of the first line, keep the file's indentation in place.
    first_needle_line = needle.strip("\n").splitlines()[0]
    if first_needle_line == first_needle_line.lstrip():
        start += len(hay_lines[i]) - len(hay_lines[i].lstrip())
    # Keep the trailing newline of the last matched line in place.
    if hay_lines[i + n - 1].endswith("\n"):
        end -= 1
    return start, end


async def tool_read_file(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    path = (tool_input.get("path") or "").strip().lstrip("/")
    file = await _find_file(project_id, path)
    if not file:
        return {"success": False, "error": f"File {path} not found. Call list_files to see the available paths."}
    return {"success": True, "path": path, "content": file.content, "file_type": file.file_type}


async def tool_list_files(project_id: str) -> Dict[str, Any]:
    files = await file_service.get_files_by_project(project_id)
    file_list = []
    directories = set()
    for f in files:
        full_path = _full_path(f)
        file_list.append({
            "path": full_path,
            "type": f.file_type,
            "lines": len((f.content or "").splitlines()),
        })
        directories.add(full_path.rsplit("/", 1)[0] if "/" in full_path else ".")

    return {
        "success": True,
        "files": sorted(file_list, key=lambda x: x["path"]),
        "directories": sorted(directories),
        "count": len(file_list),
    }


async def project_snapshot(project_id: str, active_path: Optional[str] = None) -> str:
    """Compact file listing for the system prompt so the agent skips a list_files round-trip."""
    listing = await tool_list_files(project_id)
    if not listing.get("files"):
        return "(the project has no files yet)"
    lines = []
    for f in listing["files"]:
        marker = "  ← open in editor" if active_path and f["path"] == active_path else ""
        lines.append(f"- {f['path']} ({f['lines']} lines){marker}")
    return "\n".join(lines)


async def tool_compile_project(project_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    """Compile the whole project with its configured toolchain and report errors back to the agent."""
    from models.compilation import CompileRequest
    from services.compiler_service import compiler_service
    from services.project_service import project_service

    project = await project_service.get_project(project_id)
    if not project:
        return {"success": False, "error": "Project not found."}

    files = await file_service.get_files_by_project(project_id)
    if not files:
        return {"success": False, "error": "The project has no files to compile."}

    files_dict = {_full_path(f): (f.content or "") for f in files}
    requested = (tool_input.get("main_file") or "").strip().lstrip("/")
    main_file = requested if requested in files_dict else None
    if main_file is None:
        main_file = next((p for p in files_dict if p.endswith(".ino")), None)
    if main_file is None:
        main_file = next((p for p in files_dict if p.rsplit("/", 1)[-1] in ("main.cpp", "main.c")), None)
    if main_file is None:
        main_file = next(iter(files_dict))

    request = CompileRequest(
        compiler=project.target_compiler,
        file_ids=[f.id for f in files],
        main_file=main_file,
        project_id=project_id,
    )
    result = await compiler_service.compile_code(request, files_dict)
    ok = result.status.value == "success"
    errors = list(result.errors or [])[:MAX_COMPILE_ERRORS]
    return {
        "success": ok,
        "status": result.status.value,
        "compiler": project.target_compiler.value,
        "main_file": main_file,
        "errors": errors,
        "output": _tail(result.output or ""),
        "compile_time_ms": result.compile_time_ms,
        "message": "Build passed" if ok else f"Build failed with {len(errors)} error(s)",
    }


async def tool_execute_in_sandbox(workspace_id: str, tool_input: Dict[str, Any]) -> Dict[str, Any]:
    from services.sandbox_service import sandbox_service
    from schemas.sandbox import CodeExecutionRequest

    command = (tool_input.get("command") or "").strip()
    timeout = min(int(tool_input.get("timeout", 60)), 120)
    if not command:
        return {"success": False, "error": "No command provided"}

    try:
        result = await sandbox_service.execute_code(
            CodeExecutionRequest(workspace_id=workspace_id, code=command, timeout=timeout)
        )
    except Exception as e:
        return {"success": False, "error": str(e)}

    return {
        "success": result.success,
        "stdout": _tail(result.stdout or ""),
        "stderr": _tail(result.stderr or ""),
        "exit_code": result.exit_code,
        "execution_time": result.execution_time,
    }


async def tool_search_web(tool_input: Dict[str, Any]) -> Dict[str, Any]:
    from core.config import settings

    query = (tool_input.get("query") or "").strip()
    num_results = min(int(tool_input.get("num_results", 5)), 10)
    if not query:
        return {"success": False, "error": "No search query provided"}
    if not settings.EXA_API_KEY:
        return {"success": False, "error": "Web search is not configured on this server (EXA_API_KEY missing)."}

    try:
        from exa_py import Exa
    except ImportError:
        return {"success": False, "error": "exa-py is not installed on this server."}

    try:
        exa = Exa(api_key=settings.EXA_API_KEY)
        response = exa.search(
            query=query, type="auto", num_results=num_results,
            contents={"highlights": {"max_characters": 2000}},
        )
    except Exception as e:
        return {"success": False, "error": str(e)}

    results = []
    for r in response.results:
        highlights = getattr(r, "highlights", None) or []
        results.append({"title": r.title or "", "url": r.url or "", "snippet": " … ".join(highlights)})
    return {"success": True, "query": query, "results": results, "count": len(results)}
