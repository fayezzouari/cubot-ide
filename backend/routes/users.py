from fastapi import APIRouter, status

from core.auth import CurrentUser
from models.user import UserSync, UserResponse
from services.user_service import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/sync", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def sync_user(current_user: CurrentUser):
    """Called after Google OAuth login — creates user if new, verifies/updates if existing."""
    data = UserSync(
        google_id=current_user["sub"],
        email=current_user["email"],
        name=current_user["name"],
        picture=current_user.get("picture"),
    )
    return await user_service.sync_user(data)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUser):
    """Get the current authenticated user's profile."""
    user = await user_service.get_by_google_id(current_user["sub"])
    if not user:
        data = UserSync(
            google_id=current_user["sub"],
            email=current_user["email"],
            name=current_user["name"],
            picture=current_user.get("picture"),
        )
        return await user_service.sync_user(data)
    return user
