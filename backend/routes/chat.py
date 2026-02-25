from fastapi import APIRouter, HTTPException, status
from typing import List, Optional

from models.chat import ChatRequest, ChatResponse, ChatMessageInDB, StepExecutionRequest, StepExecutionResponse
from services.ai_service import ai_service

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/{project_id}", response_model=ChatResponse)
async def chat(project_id: str, request: ChatRequest):
    """
    Send a message to the AI assistant and get a response
    
    The request can include:
    - message: The user's message/prompt
    - file_context: Optional list of files to include as context
    - compiler: Optional target compiler for context-aware responses
    - conversation_history: Optional previous messages for context
    """
    response = await ai_service.chat(project_id, request)
    return response


@router.get("/{project_id}/history", response_model=List[ChatMessageInDB])
async def get_chat_history(project_id: str, limit: int = 50):
    """Get chat history for a project"""
    history = await ai_service.get_chat_history(project_id, limit)
    return history


@router.delete("/{project_id}/history")
async def clear_chat_history(project_id: str):
    """Delete all chat messages for a project"""
    await ai_service.clear_chat_history(project_id)
    return {"success": True}


@router.post("/{project_id}/execute-step", response_model=StepExecutionResponse)
async def execute_step(project_id: str, request: StepExecutionRequest):
    """
    Execute a single plan step with the AI agent.
    The agent uses file tools (and optionally the Daytona sandbox) to complete the task.
    """
    response = await ai_service.execute_step(project_id, request)
    return response


@router.post("/{project_id}/apply-operations")
async def apply_file_operations(project_id: str, operations: List[dict]):
    """
    Apply file operations suggested by the AI
    
    Each operation should have:
    - operation: "create_or_update" or "delete"
    - path: The file path
    - content: The file content (for create_or_update)
    """
    results = await ai_service.apply_file_operations(project_id, operations)
    return {"results": results}
