import json
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.chat import (
    ChatRequest, ChatResponse, ChatMessageInDB, StepExecutionRequest, StepExecutionResponse,
    ThreadSummary, ThreadCreate, ThreadUpdate,
)
from services import chat_threads
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
async def get_chat_history(project_id: str, limit: int = 200, thread_id: Optional[str] = None):
    """Messages of one thread (or of the whole project when no thread is given)."""
    return await ai_service.get_chat_history(project_id, limit, thread_id)


@router.delete("/{project_id}/history")
async def clear_chat_history(project_id: str):
    """Delete every thread and message of the project."""
    await ai_service.clear_chat_history(project_id)
    return {"success": True}


@router.get("/{project_id}/threads", response_model=List[ThreadSummary])
async def list_threads(project_id: str):
    """Conversations of the project, most recently active first."""
    return await chat_threads.list_threads(project_id)


@router.post("/{project_id}/threads", response_model=ThreadSummary, status_code=201)
async def create_thread(project_id: str, body: ThreadCreate):
    thread_id = await chat_threads.create_thread(project_id, body.title)
    threads = await chat_threads.list_threads(project_id)
    return next(t for t in threads if t.id == thread_id)


@router.put("/{project_id}/threads/{thread_id}")
async def rename_thread(project_id: str, thread_id: str, body: ThreadUpdate):
    if not await chat_threads.rename_thread(project_id, thread_id, body.title):
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"success": True}


@router.delete("/{project_id}/threads/{thread_id}")
async def delete_thread(project_id: str, thread_id: str):
    if not await chat_threads.delete_thread(project_id, thread_id):
        raise HTTPException(status_code=404, detail="Thread not found")
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
