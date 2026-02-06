from fastapi import APIRouter

from controllers.wiring_controller import generate_wiring
from schemas.wiring import WiringRequest, WiringResponse

router = APIRouter(prefix="/wiring", tags=["wiring"])


@router.post("/generate", response_model=WiringResponse)
async def generate_wiring_route(request: WiringRequest):
    return await generate_wiring(request)
