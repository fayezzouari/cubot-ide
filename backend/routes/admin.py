from fastapi import APIRouter, Depends, Query

from core.auth import require_admin
from schemas.admin import AdminOverview, AdminUsage, AdminUserPage
from services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/access")
async def check_access():
    """200 for admins, 403 for everyone else. The frontend gates the admin pages on it."""
    return {"is_admin": True}


@router.get("/overview", response_model=AdminOverview)
async def get_overview():
    """Platform totals, with today's and yesterday's counts for each."""
    return await admin_service.overview()


@router.get("/usage", response_model=AdminUsage)
async def get_usage(days: int = Query(30, ge=1, le=365)):
    """Daily counts of new users, projects, AI messages and passed lessons."""
    return await admin_service.usage(days)


@router.get("/users", response_model=AdminUserPage)
async def get_users(
    search: str = Query("", max_length=200),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """All users, newest first, with their project and lesson counts."""
    return await admin_service.list_users(search, skip, limit)
