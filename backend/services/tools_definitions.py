"""
Tool definitions for the IDE coding agent (Bedrock invoke_model format).

Every tool is a `toolSpec` dict. `get_tool_config` assembles the set the agent
may use for one request: file tools always, the sandbox/compile/web tools only
when the caller has them available.
"""

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _tool(name: str, description: str, properties: Dict[str, Any], required: list[str]) -> Dict[str, Any]:
    return {
        "toolSpec": {
            "name": name,
            "description": description,
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                }
            },
        }
    }


LIST_FILES_TOOL = _tool(
    "list_files",
    "List every file in the project with its full path, plus the set of directories. "
    "The project snapshot in your instructions is taken at the start of the turn; call this "
    "if you created files and need fresh paths.",
    {},
    [],
)

READ_FILE_TOOL = _tool(
    "read_file",
    "Read the full content of one project file. Always read a file before editing it "
    "unless its content is already in your context.",
    {
        "path": {"type": "string", "description": "Full path as listed by list_files (e.g. 'src/main.cpp')."},
    },
    ["path"],
)

CREATE_FILE_TOOL = _tool(
    "create_file",
    "Create a new file. Fails if the path already exists (use edit_file or update_file instead).",
    {
        "path": {"type": "string", "description": "Full path relative to the project root (e.g. 'src/sensors.h')."},
        "content": {"type": "string", "description": "The complete file content."},
        "summary": {"type": "string", "description": "One short sentence: what this file is for."},
    },
    ["path", "content"],
)

EDIT_FILE_TOOL = _tool(
    "edit_file",
    "Replace one exact text span in an existing file. Preferred for targeted changes: "
    "cheaper and safer than rewriting the whole file. `old_text` must appear exactly once; "
    "include enough surrounding lines to make it unique. Whitespace and indentation must match.",
    {
        "path": {"type": "string", "description": "Full path of the file to edit."},
        "old_text": {"type": "string", "description": "Exact text to replace (must match once)."},
        "new_text": {"type": "string", "description": "Replacement text."},
        "summary": {"type": "string", "description": "One short sentence describing the change."},
    },
    ["path", "old_text", "new_text"],
)

UPDATE_FILE_TOOL = _tool(
    "update_file",
    "Overwrite an existing file with new complete content. Use only for rewrites that touch "
    "most of the file; prefer edit_file for localized changes.",
    {
        "path": {"type": "string", "description": "Full path of the file to overwrite."},
        "content": {"type": "string", "description": "The new complete file content."},
        "summary": {"type": "string", "description": "One short sentence describing the change."},
    },
    ["path", "content"],
)

COMPILE_PROJECT_TOOL = _tool(
    "compile_project",
    "Compile the project with its configured toolchain and return the result. Call this after "
    "changing code so you can verify it builds; if it fails, fix the reported errors and compile again.",
    {
        "main_file": {
            "type": "string",
            "description": "Optional entry file (e.g. 'sketch.ino'). Defaults to the project's main sketch.",
        },
    },
    [],
)

EXECUTE_IN_SANDBOX_TOOL = _tool(
    "execute_in_sandbox",
    "Run a shell command in the live sandbox workspace (build, test, install packages, inspect "
    "the filesystem). Returns stdout, stderr and the exit code.",
    {
        "command": {"type": "string", "description": "Shell command (e.g. 'colcon build', 'python3 node.py')."},
        "timeout": {"type": "integer", "description": "Timeout in seconds (default 60, max 120).", "default": 60},
    },
    ["command"],
)

SEARCH_WEB_TOOL = _tool(
    "search_web",
    "Search the web for current technical information: library docs, API changes, datasheets, "
    "release notes. Use when the answer depends on information newer than your training data.",
    {
        "query": {"type": "string", "description": "Search query."},
        "num_results": {"type": "integer", "description": "Results to return (default 5, max 10).", "default": 5},
    },
    ["query"],
)

FILE_TOOL_NAMES = {"create_file", "edit_file", "update_file"}


def get_tool_config(
    include_sandbox: bool = False,
    include_websearch: bool = False,
    include_compile: bool = False,
    read_only: bool = False,
) -> Dict[str, Any]:
    """Assemble the tool list for one agent run."""
    tools = []
    if include_websearch:
        tools.append(SEARCH_WEB_TOOL)
    tools.extend([LIST_FILES_TOOL, READ_FILE_TOOL])
    if not read_only:
        tools.extend([CREATE_FILE_TOOL, EDIT_FILE_TOOL, UPDATE_FILE_TOOL])
    if include_compile:
        tools.append(COMPILE_PROJECT_TOOL)
    if include_sandbox:
        tools.append(EXECUTE_IN_SANDBOX_TOOL)

    logger.info("tool config: %s", [t["toolSpec"]["name"] for t in tools])
    return {"tools": tools}
