import json
from typing import AsyncGenerator, List

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from models.chat import ChatRequest, ChatResponse, ChatMessageInDB, StepExecutionRequest, StepExecutionResponse
from services.ai_service import ai_service

router = APIRouter(prefix="/chat", tags=["chat"])


def _sse(events: AsyncGenerator[dict, None]) -> StreamingResponse:
    async def stream():
        async for event in events:
            yield f"data: {json.dumps(event, default=str)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{project_id}", response_model=ChatResponse)
async def chat(project_id: str, request: ChatRequest):
    """One agent turn, answered when the agent is done. Prefer `/stream` from the IDE."""
    return await ai_service.chat(project_id, request)


@router.post("/{project_id}/stream")
async def chat_stream(project_id: str, request: ChatRequest):
    """
    One agent turn as server-sent events.

    Events: `status` (what the agent is doing), `tool_start` / `tool_end` (one per tool
    call, with the resulting file operation or command log), then `done` with the final
    message, file operations and execution logs, or `error`. Closing the connection
    cancels the turn.
    """
    return _sse(ai_service.chat_stream(project_id, request))


@router.get("/{project_id}/history", response_model=List[ChatMessageInDB])
async def get_chat_history(project_id: str, limit: int = 50):
    """Get chat history for a project"""
    return await ai_service.get_chat_history(project_id, limit)


@router.delete("/{project_id}/history")
async def clear_chat_history(project_id: str):
    """Delete all chat messages for a project"""
    await ai_service.clear_chat_history(project_id)
    return {"success": True}


@router.post("/{project_id}/execute-step", response_model=StepExecutionResponse)
async def execute_step(project_id: str, request: StepExecutionRequest):
    """Execute a single plan step with the agent (file tools, compile, sandbox, web)."""
    return await ai_service.execute_step(project_id, request)


@router.post("/{project_id}/apply-operations")
async def apply_file_operations(project_id: str, operations: List[dict]):
    """Apply file operations (create_file / edit_file / update_file dicts) to the project."""
    results = await ai_service.apply_file_operations(project_id, operations)
    return {"results": results}
