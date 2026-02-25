import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from models.cad import CadChatRequest, CadChatResponse, CadExportRequest
from services.cad_service import cad_service

router = APIRouter(prefix="/cad", tags=["cad"])


@router.post("/{session_id}/generate", response_model=CadChatResponse)
async def generate_cad(session_id: str, request: CadChatRequest):
    """
    Generate or update a CAD model from a natural-language prompt.

    Returns CadQuery code, a base64-encoded STL for preview, and an
    explanation of what was created / changed.
    """
    response = await cad_service.generate(session_id, request)
    return response


@router.post("/{session_id}/generate-planned")
async def generate_planned(session_id: str, request: CadChatRequest):
    """
    Generate a CAD model using the layered planning pipeline.
    Streams Server-Sent Events (SSE) with planning + per-part execution progress.
    """
    async def event_stream():
        async for event in cad_service.generate_planned_stream(session_id, request):
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/export-stl")
async def export_stl(request: CadExportRequest):
    """
    Execute CadQuery code and return the resulting STL file for download.
    """
    stl_bytes, error = cad_service.export_stl(request.cadquery_code)
    if error:
        raise HTTPException(status_code=400, detail=error)

    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": "attachment; filename=model.stl"},
    )


@router.get("/{session_id}/history")
async def get_session_history(session_id: str):
    """Retrieve the conversation history for a CAD session."""
    session = await cad_service.get_session(session_id)
    if not session:
        return {"messages": [], "current_code": None}
    return {
        "messages": session.get("messages", []),
        "current_code": session.get("current_code"),
    }
