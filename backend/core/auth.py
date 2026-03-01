from typing import Annotated, Optional
from fastapi import Depends, HTTPException, status
from jose import jwt, JWTError
from starlette.requests import HTTPConnection
from core.config import settings


def _extract_token(conn: HTTPConnection) -> Optional[str]:
    """Extract bearer token from Authorization header or ?token= query param (WebSocket)."""
    auth = conn.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):]
    return conn.query_params.get("token")


async def get_current_user(conn: HTTPConnection) -> dict:
    token = _extract_token(conn)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return jwt.decode(token, settings.NEXTAUTH_SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


CurrentUser = Annotated[dict, Depends(get_current_user)]
