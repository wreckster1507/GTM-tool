"""
Demo generation service — orchestrates:
  1. Extract text from PDF or DOCX (Path A) OR format editor JSON (Path B)
  2. Scrape client brand data
  3. Call Claude to generate the complete HTML
  4. Persist result to DB

Design notes:
  - NO outer timeout wrapping the model call — demo_ai.py handles its own
    retry + per-attempt timeouts internally.
  - Every stage is persisted to demo.error_message so the frontend (and logs)
    can show exactly where things are.  Format: "[stage:name] detail"
  - All exceptions bubble into a single handler that marks status=error.
"""
import io
import logging
import time
from datetime import datetime
from uuid import UUID

import pdfplumber
from docx import Document
from sqlmodel.ext.asyncio.session import AsyncSession

from app.clients.brand_scraper import scrape_brand
from app.clients.demo_ai import generate_demo_html, validate_demo_html
from app.models.custom_demo import CustomDemo

logger = logging.getLogger(__name__)


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_pdf_text(file_bytes: bytes) -> str:
    """Extract all text from a PDF byte buffer."""
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        pages = []
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
    return "\n\n".join(pages)


def extract_docx_text(file_bytes: bytes) -> str:
    """Extract all paragraph text from a DOCX byte buffer."""
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs)


def editor_content_to_text(editor_content: list[dict]) -> str:
    """
    Convert the in-app editor's scene list into a readable production guide
    that Claude can use as a demo script.

    editor_content schema:
      [
        {
          "scene_title": "Data Ingestion",
          "beacon_steps": ["...", "..."],
          "client_screen": "Description of what the client system shows",
          "reveal_description": "What the reveal shot looks like"
        },
        ...
      ]
    """
    lines = ["# Custom Demo Production Guide\n"]
    for i, scene in enumerate(editor_content, 1):
        title = scene.get("scene_title", f"Scene {i}")
        lines.append(f"## Scene {i}: {title}")

        steps = scene.get("beacon_steps", [])
        if steps:
            lines.append("### Beacon Execution Steps")
            for step in steps:
                lines.append(f"- {step}")

        screen = scene.get("client_screen", "")
        if screen:
            lines.append(f"### Client System Screen\n{screen}")

        reveal = scene.get("reveal_description", "")
        if reveal:
            lines.append(f"### Reveal Shot\n{reveal}")

        lines.append("")

    return "\n".join(lines)


def compact_production_guide(text: str, max_chars: int = 32000) -> str:
    """Keep guide size bounded so model calls stay reliable for large uploads."""
    guide = (text or "").strip()
    if len(guide) <= max_chars:
        return guide

    head = guide[:22000]
    tail = guide[-8000:]
    return (
        head
        + "\n\n[...content truncated for model reliability...]\n\n"
        + tail
        + "\n\n[Note: Input was truncated to fit generation limits.]"
    )


# ── Stage tracker ─────────────────────────────────────────────────────────────

class _StageTracker:
    """Persists stage progress to the DB so status polling shows real progress."""

    def __init__(self, demo: CustomDemo, session: AsyncSession):
        self.demo = demo
        self.session = session
        self.current = "init"

    async def advance(self, stage: str, detail: str = "") -> None:
        self.current = stage
        msg = f"[stage:{stage}] {detail}".strip()
        logger.info("[demo_gen:%s] %s", self.demo.id, msg)
        self.demo.error_message = msg
        self.demo.updated_at = datetime.utcnow()
        self.session.add(self.demo)
        await self.session.commit()


# ── Main orchestrator ─────────────────────────────────────────────────────────

async def run_generation(demo_id: UUID, session: AsyncSession) -> None:
    """
    Background-safe orchestrator: loads the demo record, runs generation,
    persists result.  Marks status=error on any exception.

    Key difference from old version: NO outer asyncio.wait_for() wrapping
    the model call.  demo_ai.py handles its own per-attempt timeouts and
    retry with backoff — adding an outer timeout caused premature cancellation.
    """
    demo = await session.get(CustomDemo, demo_id)
    if not demo:
        logger.error("[demo_gen] demo_id=%s not found in DB", demo_id)
        return

    tracker = _StageTracker(demo, session)
    t0 = time.monotonic()

    try:
        # ── Mark generating ──────────────────────────────────────────────
        demo.status = "generating"
        await tracker.advance("init", "starting generation pipeline")

        # ── Step 1: Prepare production guide text ────────────────────────
        await tracker.advance("prepare_guide", "extracting source text")

        if demo.creation_path == "editor":
            production_guide = editor_content_to_text(demo.editor_content or [])
        else:
            production_guide = demo.source_text or ""

        production_guide = compact_production_guide(production_guide)
        guide_chars = len(production_guide)

        if guide_chars < 50:
            raise ValueError(
                f"Production guide is too short ({guide_chars} chars). "
                "Please provide a more detailed guide or brief."
            )

        await tracker.advance("prepare_guide", f"ready — {guide_chars} chars")

        # ── Step 2: Scrape brand data ────────────────────────────────────
        await tracker.advance("brand_scrape", "fetching brand data")

        if demo.client_domain and not demo.brand_data:
            try:
                brand_data = await scrape_brand(demo.client_domain)
                if brand_data.get("error"):
                    logger.warning(
                        "[demo_gen:%s] brand scrape error (non-fatal): %s",
                        demo_id, brand_data["error"],
                    )
            except Exception as exc:
                logger.warning(
                    "[demo_gen:%s] brand scrape failed (non-fatal): %s",
                    demo_id, exc,
                )
                brand_data = {}
        else:
            brand_data = demo.brand_data or {}

        demo.brand_data = brand_data
        await tracker.advance("brand_scrape", "done")

        # ── Step 3: Call Claude (no outer timeout!) ──────────────────────
        await tracker.advance("model_generation", "calling Claude API")

        html = await generate_demo_html(
            production_guide=production_guide,
            client_name=demo.client_name or demo.title,
            client_domain=demo.client_domain or "",
            brand_data=brand_data,
        )

        elapsed = time.monotonic() - t0

        # ── Step 4: Final validation ─────────────────────────────────────
        await tracker.advance("validation", "checking generated HTML")

        report = validate_demo_html(html)
        if not report["valid"]:
            raise RuntimeError(
                f"Generated HTML failed validation: {report['details']} "
                f"({len(html)} chars, {elapsed:.0f}s elapsed)"
            )

        # ── Success ──────────────────────────────────────────────────────
        demo.html_content = html
        demo.status = "ready"
        demo.error_message = None

        logger.info(
            "[demo_gen:%s] SUCCESS — %d chars, %.0fs total",
            demo_id, len(html), elapsed,
        )

    except Exception as exc:
        elapsed = time.monotonic() - t0
        demo.status = "error"
        demo.error_message = f"[stage:{tracker.current}] {exc}"

        logger.error(
            "[demo_gen:%s] FAILED at stage=%s after %.0fs: %s",
            demo_id, tracker.current, elapsed, exc,
        )

    finally:
        demo.updated_at = datetime.utcnow()
        session.add(demo)
        await session.commit()
