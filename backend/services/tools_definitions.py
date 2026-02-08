"""
Tool definitions for AWS Bedrock Converse API
These define the tools available to the AI assistant
"""

from typing import Dict, Any


def get_tool_config() -> Dict[str, Any]:
    """
    Get tool configuration for Bedrock Converse API
    
    Returns:
        Dictionary containing tool specifications
    """
    return {
        "tools": [
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
                    "description": "List all files in the project. Use this to understand the project structure.",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {},
                            "required": []
                        }
                    }
                }
            }
        ]
    }


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
