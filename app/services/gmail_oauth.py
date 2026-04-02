from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

import httpx
import jwt

from app.config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
STATE_ALGORITHM = "HS256"


def build_gmail_connect_url(state: str) -> str:
    from urllib.parse import urlencode

    params = {
        "client_id": settings.gmail_client_id,
        "redirect_uri": settings.GMAIL_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": GMAIL_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def create_gmail_oauth_state(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "scope": "gmail_connect",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=STATE_ALGORITHM)


def decode_gmail_oauth_state(token: str) -> Optional[dict[str, Any]]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[STATE_ALGORITHM])
        if payload.get("scope") != "gmail_connect":
            return None
        return payload
    except jwt.PyJWTError:
        return None


async def exchange_gmail_code(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.gmail_client_id,
                "client_secret": settings.gmail_client_secret,
                "redirect_uri": settings.GMAIL_OAUTH_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()

        profile_resp = await client.get(
            GMAIL_PROFILE_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        profile_resp.raise_for_status()
        profile = profile_resp.json()

    return {
        "email_address": profile.get("emailAddress"),
        "token_data": {
            "token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "scopes": token_data.get("scope", GMAIL_SCOPE).split(" "),
            "expiry": (datetime.utcnow() + timedelta(seconds=int(token_data.get("expires_in", 3600)))).isoformat(),
        },
    }
