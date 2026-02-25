"""
Tool definitions for AWS Bedrock Converse API
These define the tools available to the AI assistant
"""

from typing import Dict, Any


_EXECUTE_IN_SANDBOX_TOOL = {
    "toolSpec": {
        "name": "execute_in_sandbox",
        "description": "Execute a shell command in the Daytona sandbox workspace. Use this to run builds, install packages, run tests, or verify code. Returns stdout, stderr, and exit code.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute (e.g., 'colcon build', 'python3 script.py', 'pip install rclpy')"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds (default: 60, max: 120)",
                        "default": 60
                    }
                },
                "required": ["command"]
            }
        }
    }
}

_SEARCH_WEB_TOOL = {
    "toolSpec": {
        "name": "search_web",
        "description": "Search the web for up-to-date information: recent releases, library docs, changelogs, blog posts, GitHub repos, and technical references. Use this when you need information beyond your training data.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query (e.g., 'ROS 2 Humble latest packages', 'Arduino ESP32 3.x migration guide', 'colcon build flags reference')"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results to return (default: 5, max: 10)",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
}


def get_tool_config(include_sandbox: bool = False, include_websearch: bool = False) -> Dict[str, Any]:
    """
    Get tool configuration for Bedrock Converse API.

    Args:
        include_sandbox: When True, adds the execute_in_sandbox tool.
        include_websearch: When True, adds the search_web tool.

    Returns:
        Dictionary containing tool specifications
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"get_tool_config: include_sandbox={include_sandbox}, include_websearch={include_websearch}")

    tools = []

    # Add web search first if enabled (priority)
    if include_websearch:
        tools.append(_SEARCH_WEB_TOOL)
        logger.info("Added search_web tool (priority)")

    # Add remaining file tools
    tools.extend([
            {
                "toolSpec": {
                    "name": "create_file",
                    "description": "Create a new file in the project with the specified path and content. Use this when the user asks to create a new file or add new code.",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "The file path relative to project root (e.g., 'src/main.cpp', 'include/config.h')"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "The complete content of the file"
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Brief description of what this file does"
                                }
                            },
                            "required": ["path", "content"]
                        }
                    }
                }
            },
            {
                "toolSpec": {
                    "name": "update_file",
                    "description": "Update an existing file's content. Use this when the user asks to modify, edit, or update existing code.",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "The file path to update"
                                },
                                "content": {
                                    "type": "string",
                                    "description": "The new complete content of the file"
                                },
                                "changes_description": {
                                    "type": "string",
                                    "description": "Brief description of what changed"
                                }
                            },
                            "required": ["path", "content"]
                        }
                    }
                }
            },
            {
                "toolSpec": {
                    "name": "read_file",
                    "description": "Read the current content of a file. Use this when you need to see the current state of a file before modifying it.",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "The file path to read"
                                }
                            },
                            "required": ["path"]
                        }
                    }
                }
            },
            {
                "toolSpec": {
                    "name": "list_files",
                    "description": "List all files in the project. Returns a list of files and a deduplicated `directories` array to understand the project structure. Call this before creating new files so you place them under existing packages (e.g., 'src/pkg_name/scripts').",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {},
                            "required": []
                        }
                    }
                }
            }
    ])

    if include_sandbox:
        tools.append(_EXECUTE_IN_SANDBOX_TOOL)
        logger.info("Added execute_in_sandbox tool")

    tool_names = [t.get("toolSpec", {}).get("name", "unknown") for t in tools]
    logger.info(f"Final tool config: {tool_names}")
    return {"tools": tools}


# Tool metadata for documentation
TOOL_METADATA = {
    "create_file": {
        "name": "Create File",
        "category": "File Operations",
        "description": "Creates a new file in the project",
        "examples": [
            "Create a new file called main.cpp",
            "Add a header file for LED control",
            "Create a configuration file"
        ]
    },
    "update_file": {
        "name": "Update File",
        "category": "File Operations",
        "description": "Updates an existing file's content",
        "examples": [
            "Update main.cpp to add button control",
            "Modify the LED class to support PWM",
            "Fix the bug in the sensor reading code"
        ]
    },
    "read_file": {
        "name": "Read File",
        "category": "File Operations",
        "description": "Reads the current content of a file",
        "examples": [
            "Read the main.cpp file",
            "Show me the contents of config.h",
            "What's in the LED class?"
        ]
    },
    "list_files": {
        "name": "List Files",
        "category": "File Operations",
        "description": "Lists all files in the project",
        "examples": [
            "What files are in this project?",
            "Show me the project structure",
            "List all source files"
        ]
    }
}
