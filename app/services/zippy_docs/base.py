"""Shared helpers for Zippy's document generators."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

# Everything Zippy generates lands under this directory. FastAPI serves it via
# /zippy_outputs so the frontend can link directly to the finished file.
ZIPPY_OUTPUT_DIR = Path(
    os.environ.get(
        "ZIPPY_OUTPUT_DIR",
        str(Path(__file__).resolve().parents[3] / "storage" / "zippy_outputs"),
    )
).resolve()
ZIPPY_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class GeneratedDocument:
    """What every generator returns to the agent."""

    filename: str                    # user-facing filename e.g. "MOM - Acme - 19 Apr 2026.docx"
    path: str                        # absolute path on disk
    url: str                         # relative URL the frontend can link to (.docx fallback)
    kind: str                        # "mom" | "nda_in" | "nda_us" | "nda_sg" | "generic_docx"
    summary: str                     # one-liner shown in chat
    created_at: datetime
    drive_file_id: str = ""          # Google Drive file ID (set after upload)
    drive_url: str = ""              # Google Docs webViewLink (preferred link for user)


def _slug(value: str, max_len: int = 48) -> str:
    """Safe filename slug — strip weird chars, collapse whitespace."""
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", "", value or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned) or "untitled"
    return cleaned[:max_len].rstrip("_-")


def build_output_path(kind: str, client_name: str, extension: str = "docx") -> tuple[Path, str]:
    """Return ``(absolute_path, public_url)`` for a new document."""
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    unique = uuid4().hex[:6]
    filename = f"{_slug(kind)}-{_slug(client_name)}-{date_str}-{unique}.{extension}"
    path = ZIPPY_OUTPUT_DIR / filename
    url = f"/zippy_outputs/{filename}"
    return path, url


def human_today() -> str:
    return datetime.utcnow().strftime("%d %B %Y")
