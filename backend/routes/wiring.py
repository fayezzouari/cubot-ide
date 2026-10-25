import logging

from fastapi import APIRouter

from schemas.wiring import WiringRequest, WiringResponse, WiringGuide
from services.wiring_service import wiring_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wiring", tags=["wiring"])


@router.post("/generate", response_model=WiringResponse)
async def generate_wiring_route(request: WiringRequest):
    try:
        guide = await wiring_service.generate(
            source_code=request.source_code,
            compiler=request.compiler,
        )
        return WiringResponse(guide=guide, llm_generated=True)
    except Exception as exc:
        logger.exception("Wiring generation failed")
        fallback = WiringGuide(
            components=[],
            power=[],
            warnings=["Failed to generate wiring guide from AI."],
            summary="Wiring guide unavailable.",
            explanation=str(exc),
        )
        return WiringResponse(guide=fallback, llm_generated=False)
