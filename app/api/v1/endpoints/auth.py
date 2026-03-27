"""
Authentication endpoints — Google OAuth2 login, token exchange, user management.

The first user to sign in is automatically granted the 'admin' role.
Subsequent users default to 'sales_rep'.
"""
from typing import List
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse
from sqlmodel import func, select

from app.config import settings
from app.core.dependencies import AdminUser, CurrentUser, DBSession
from app.core.exceptions import ForbiddenError, NotFoundError, UnauthorizedError
from app.models.user import User, UserRead, UserUpdate
from app.services.auth import (
    build_google_login_url,
    create_access_token,
    exchange_google_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Google OAuth flow ────────────────────────────────────────────────────────


@router.get("/google/login")
async def google_login():
    """Redirect the user to Google's OAuth consent screen."""
    if not settings.GOOGLE_CLIENT_ID:
        raise UnauthorizedError(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
        )
    url = build_google_login_url(settings.GOOGLE_REDIRECT_URI)
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(
    session: DBSession,
    code: str = Query(..., description="Authorization code from Google"),
):
    """
    Handle the OAuth callback from Google.
    Creates the user if first login, then issues a JWT and redirects to the frontend.
    """
    # Exchange code for user info
    try:
        google_info = await exchange_google_code(code, settings.GOOGLE_REDIRECT_URI)
    except Exception:
        raise UnauthorizedError("Failed to authenticate with Google")

    # Restrict login to beacon.li domain
    email = google_info["email"]
    if not email.endswith("@beacon.li"):
        raise ForbiddenError("Only @beacon.li accounts are allowed to sign in")

    # Find or create user
    user = (
        await session.execute(
            select(User).where(User.google_id == google_info["google_id"])
        )
    ).scalar_one_or_none()

    if user is None:
        # First user becomes admin, rest are sales_rep
        user_count = (await session.execute(select(func.count(User.id)))).scalar_one()
        role = "admin" if user_count == 0 else "sales_rep"

        user = User(
            email=google_info["email"],
            name=google_info["name"],
            avatar_url=google_info.get("avatar_url"),
            google_id=google_info["google_id"],
            role=role,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
    else:
        # Update profile info from Google on each login
        user.name = google_info["name"]
        user.avatar_url = google_info.get("avatar_url")
        session.add(user)
        await session.commit()
        await session.refresh(user)

    if not user.is_active:
        raise ForbiddenError("Your account has been deactivated")

    # Issue JWT and redirect to frontend
    token = create_access_token(user.id, user.role)
    frontend_url = f"{settings.FRONTEND_URL}/auth/callback?{urlencode({'token': token})}"
    return RedirectResponse(frontend_url)


# ── Current user ─────────────────────────────────────────────────────────────


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser):
    """Return the currently authenticated user's profile."""
    return user


# ── User management (admin) ─────────────────────────────────────────────────


@router.get("/users", response_model=List[UserRead])
async def list_users(session: DBSession, _admin: AdminUser):
    """List all users. Admin only."""
    result = await session.execute(select(User).order_by(User.name))
    return result.scalars().all()


@router.get("/users/all", response_model=List[UserRead])
async def list_all_users(session: DBSession, _user: CurrentUser):
    """List all active users. Available to any authenticated user (for assignment dropdowns)."""
    result = await session.execute(
        select(User).where(User.is_active == True).order_by(User.name)  # noqa: E712
    )
    return result.scalars().all()


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: UUID,
    data: UserUpdate,
    session: DBSession,
    admin: AdminUser,
):
    """Update a user's role or active status. Admin only."""
    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")

    # Prevent admin from demoting themselves
    if user.id == admin.id and data.role and data.role != "admin":
        raise ForbiddenError("Cannot change your own admin role")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)

    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
