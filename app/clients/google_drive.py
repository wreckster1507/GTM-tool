"""
Google Drive API client.

Thin wrapper around Drive API v3 for the folder-picker feature:
  - list_folders()  — list all folders the user has access to (optionally under a parent)
  - search_folders() — name-based search
  - get_folder_metadata() — fetch a single folder's metadata
  - list_files_in_folder() — list files inside a selected folder (used later by sync)

Auth model:
The caller passes a `token_data` dict (same shape as the one stored on
UserEmailConnection.token_data — {token, refresh_token, scopes, expiry}).
We reuse the refresh helper from google_docs.py so token refresh logic
lives in one place.

Scope required: https://www.googleapis.com/auth/drive.readonly
This scope is already requested as part of PERSONAL_OAUTH_SCOPES during
the Gmail OAuth consent flow, so any user who has connected their Gmail
should already have Drive access granted.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.clients.google_docs import DRIVE_SCOPE, _refresh_token_if_needed

logger = logging.getLogger(__name__)

DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
FOLDER_MIME = "application/vnd.google-apps.folder"


def _has_drive_scope(token_data: dict) -> bool:
    scopes = token_data.get("scopes", [])
    if isinstance(scopes, list):
        return any(DRIVE_SCOPE in scope for scope in scopes)
    return DRIVE_SCOPE in str(scopes)


async def _ensure_token(
    token_data: dict,
    client_id: str,
    client_secret: str,
) -> tuple[str, dict]:
    """Refresh the token if needed. Returns (access_token, updated_token_data)."""
    if not _has_drive_scope(token_data):
        raise PermissionError(
            "Token does not include drive.readonly scope — user must reconnect Gmail."
        )
    updated = await _refresh_token_if_needed(token_data, client_id, client_secret)
    access_token = updated.get("token")
    if not access_token:
        raise ValueError("Failed to obtain a valid access token for Drive API")
    return access_token, updated


async def list_folders(
    *,
    token_data: dict,
    client_id: str,
    client_secret: str,
    parent_id: Optional[str] = None,
    page_size: int = 100,
    include_shared: bool = True,
) -> tuple[list[dict[str, Any]], dict]:
    """
    List Drive folders the user can access.

    Args:
        parent_id: If set, only returns folders directly inside this folder.
                   If None, returns top-level folders (under My Drive root + shared).
        include_shared: Include folders shared with the user (not just owned).

    Returns:
        (folders, updated_token_data)

    Each folder dict contains: id, name, parents, modifiedTime, ownedByMe, shared.
    """
    access_token, updated_token = await _ensure_token(token_data, client_id, client_secret)

    # Build the q query. Drive API v3 query syntax:
    #   mimeType = 'application/vnd.google-apps.folder'  — folders only
    #   trashed = false                                   — ignore trashed
    #   '<parent_id>' in parents                          — direct children
    q_parts = [f"mimeType='{FOLDER_MIME}'", "trashed=false"]
    if parent_id:
        q_parts.append(f"'{parent_id}' in parents")
    q = " and ".join(q_parts)

    params = {
        "q": q,
        "pageSize": page_size,
        "fields": "nextPageToken, files(id, name, parents, modifiedTime, ownedByMe, shared, driveId)",
        "orderBy": "name",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true" if include_shared else "false",
        "corpora": "allDrives" if include_shared else "user",
    }

    folders: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20) as http:
        page_token: Optional[str] = None
        while True:
            if page_token:
                params["pageToken"] = page_token
            resp = await http.get(
                f"{DRIVE_API_BASE}/files",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json() or {}
            folders.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
            # Safety: don't fetch more than a few thousand folders per call.
            if len(folders) >= 1000:
                break

    return folders, updated_token


async def search_folders(
    *,
    query: str,
    token_data: dict,
    client_id: str,
    client_secret: str,
    page_size: int = 50,
) -> tuple[list[dict[str, Any]], dict]:
    """Search for folders by name (case-insensitive contains match)."""
    access_token, updated_token = await _ensure_token(token_data, client_id, client_secret)

    safe_query = (query or "").replace("'", "\\'").strip()
    if not safe_query:
        return [], updated_token

    q = (
        f"mimeType='{FOLDER_MIME}' and trashed=false and name contains '{safe_query}'"
    )
    params = {
        "q": q,
        "pageSize": page_size,
        "fields": "files(id, name, parents, modifiedTime, ownedByMe, shared, driveId)",
        "orderBy": "name",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
        "corpora": "allDrives",
    }

    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(
            f"{DRIVE_API_BASE}/files",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        resp.raise_for_status()
        data = resp.json() or {}
        return data.get("files", []), updated_token


async def get_folder_metadata(
    *,
    folder_id: str,
    token_data: dict,
    client_id: str,
    client_secret: str,
) -> tuple[Optional[dict[str, Any]], dict]:
    """Fetch metadata for a single folder by ID. Returns None if not found / no access."""
    access_token, updated_token = await _ensure_token(token_data, client_id, client_secret)

    params = {
        "fields": "id, name, parents, modifiedTime, ownedByMe, shared, driveId, mimeType",
        "supportsAllDrives": "true",
    }
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(
            f"{DRIVE_API_BASE}/files/{folder_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        if resp.status_code in {403, 404}:
            return None, updated_token
        resp.raise_for_status()
        meta = resp.json() or {}

    if meta.get("mimeType") != FOLDER_MIME:
        # The ID points to something, but not a folder.
        return None, updated_token
    return meta, updated_token


async def list_files_in_folder_recursive(
    *,
    folder_id: str,
    token_data: dict,
    client_id: str,
    client_secret: str,
    max_files: int = 2000,
) -> tuple[list[dict[str, Any]], dict]:
    """
    Walk a folder recursively, returning every non-folder file beneath it.

    Drive's API doesn't have a "descendants" filter, so we do a BFS: fetch
    direct children, queue the sub-folders, repeat. Stops once ``max_files``
    is reached to protect against pathological trees.
    """
    visited: set[str] = set()
    queue: list[str] = [folder_id]
    files: list[dict[str, Any]] = []
    updated = token_data

    while queue and len(files) < max_files:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)

        # Direct files (non-folder) in this folder
        batch_files, updated = await list_files_in_folder(
            folder_id=current,
            token_data=updated,
            client_id=client_id,
            client_secret=client_secret,
            max_files=max_files - len(files),
        )
        files.extend(batch_files)

        # Sub-folders to traverse next
        sub_folders, updated = await list_folders(
            token_data=updated,
            client_id=client_id,
            client_secret=client_secret,
            parent_id=current,
        )
        for sub in sub_folders:
            if sub.get("id") and sub["id"] not in visited:
                queue.append(sub["id"])

    return files[:max_files], updated


# MIME-type → export format for Google native docs. We bias toward formats
# pdfplumber/python-docx can handle downstream without extra tooling.
GOOGLE_EXPORT_MAP = {
    "application/vnd.google-apps.document": (
        "text/plain",
        ".txt",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "text/csv",
        ".csv",
    ),
    "application/vnd.google-apps.presentation": (
        "text/plain",
        ".txt",
    ),
}


async def download_file_bytes(
    *,
    file_id: str,
    mime_type: str,
    token_data: dict,
    client_id: str,
    client_secret: str,
) -> tuple[Optional[bytes], str, dict]:
    """
    Download a Drive file's bytes for indexing.

    Returns ``(bytes, effective_mime_type, updated_token)``. For Google-native
    files we export to a plain format; for normal files we use ``alt=media``.
    ``bytes`` is None if the file can't be fetched (e.g. 403, empty).
    """
    access_token, updated_token = await _ensure_token(token_data, client_id, client_secret)

    export = GOOGLE_EXPORT_MAP.get(mime_type)
    async with httpx.AsyncClient(timeout=60) as http:
        if export is not None:
            export_mime, _ = export
            resp = await http.get(
                f"{DRIVE_API_BASE}/files/{file_id}/export",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"mimeType": export_mime},
            )
            effective = export_mime
        else:
            resp = await http.get(
                f"{DRIVE_API_BASE}/files/{file_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"alt": "media", "supportsAllDrives": "true"},
            )
            effective = mime_type

        if resp.status_code in {403, 404}:
            logger.info("Drive file %s returned %s — skipping", file_id, resp.status_code)
            return None, effective, updated_token
        resp.raise_for_status()
        return resp.content, effective, updated_token


async def list_files_in_folder(
    *,
    folder_id: str,
    token_data: dict,
    client_id: str,
    client_secret: str,
    page_size: int = 100,
    max_files: int = 500,
) -> tuple[list[dict[str, Any]], dict]:
    """
    List non-folder files directly inside a folder.

    Used later by the sync task that ingests Drive content into the CRM.
    """
    access_token, updated_token = await _ensure_token(token_data, client_id, client_secret)

    q = (
        f"'{folder_id}' in parents and trashed=false "
        f"and mimeType != '{FOLDER_MIME}'"
    )
    params = {
        "q": q,
        "pageSize": page_size,
        "fields": "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
        "orderBy": "modifiedTime desc",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }

    files: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=20) as http:
        page_token: Optional[str] = None
        while True:
            if page_token:
                params["pageToken"] = page_token
            resp = await http.get(
                f"{DRIVE_API_BASE}/files",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json() or {}
            files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token or len(files) >= max_files:
                break

    return files[:max_files], updated_token
