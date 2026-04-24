"""Zippy agent — Claude tool-use loop over the user's knowledge base.

Given a conversation + a new user message, we:

    1. Retrieve a *preview* set of RAG snippets so the model knows what's
       available without needing to always call the tool.
    2. Run a tool-use loop with Claude: each iteration, hand it any prior
       tool results, let it think, and execute whatever tool it calls next.
       Stop when it emits a final text response or when the turn cap is hit.
    3. Persist the new user + assistant messages (with citations + artifacts)
       to Postgres and return the assistant turn to the caller.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.anthropic_client import get_anthropic_client
from app.config import settings
from app.models.zippy import ZippyConversation, ZippyMessage
from app.services.knowledge_search import KnowledgeSnippet, search_knowledge
from app.services.zippy_tools import (
    TOOL_DEFINITIONS,
    ToolOutcome,
    execute_tool,
)

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are Zippy, Beacon's internal Copilot-style assistant for the GTM team.

Your capabilities
-----------------
- Answer questions by searching the user's connected Google Drive folder AND
  Beacon's shared admin folder using the `search_knowledge_base` tool.
- Generate Minutes of Meeting (MOM) documents from Beacon's official Drive
  template using the pair `inspect_mom_template` + `generate_mom`.
  Beacon has an official MOM template .docx in Drive with ``{{TOKEN}}``
  placeholders for every section (client name, date, attendees, discussion
  points, decisions, action items, next steps, etc.).

  REQUIRED flow (follow in order, no shortcuts):
    1. Call `inspect_mom_template` — no arguments needed. It returns the list
       of every ``{{TOKEN}}`` in the template.
    2. Ask the user for the transcript / notes if they haven't already provided
       them. You need the raw text to fill the template accurately.
    3. Call `generate_mom` with `client_name` + the transcript/notes. The tool
       will fill every template token using Claude internally and produce a
       .docx that matches the template exactly — no extra sections, no
       invented headings.
    4. Return the .docx download link the tool produced and give a 1-line
       summary of what was captured.

  HARD RULES for MOM (read carefully — violations have happened before):
  - The ONLY acceptable output is a .docx produced from the user's
    `MOM Template.docx` in Drive. No other structure, no other source.
  - Use ONLY what the user's transcript contains. Do NOT invent discussion
    points, decisions, action items, headings, or sections.
  - Do NOT call `search_knowledge_base` for MOM content. The only source is
    the user's transcript / notes and the Drive template.
  - If `inspect_mom_template` returns `found: false`, DO NOT call
    `generate_mom`. Instead, tell the user the exact error message the tool
    returned and ask them to fix it (upload `MOM Template.docx` to the
    indexed folder, reconnect Drive, etc.). NEVER fabricate a MOM from
    scratch. NEVER describe what a MOM would contain in prose. Refusal is
    the correct answer when the template is unavailable.
  - If `generate_mom` itself returns an error, surface that error verbatim
    to the user and stop — do not retry with a made-up structure.
- Draft NDAs with the pair of tools `inspect_nda_template` + `generate_nda`.
  Beacon has an official NDA template .docx in Drive — it has BLANKS
  (underscores / dashes like `_______` or `——`) that a human fills by hand.
  You fill those blanks, you do NOT write clauses, and you NEVER use any
  other document or search the knowledge base for NDA content.

  REQUIRED flow (follow in order, no shortcuts):
    1. Ask the user which jurisdiction: india | us | singapore.
    2. Call `inspect_nda_template` with that jurisdiction. It returns a
       numbered list of every blank with surrounding context + a hint.
    3. Show the user the numbered blanks in one short message and ask them
       to provide the value for each one. If the user answers only some,
       that's fine — skipped blanks stay dashed in the output.
    4. Call `generate_nda` with `jurisdiction` + `fills` (a dict like
       `{"1": "ACME Pvt Ltd", "2": "21 April 2026"}`) using ONLY the values
       the user explicitly gave you. Do NOT invent a name, date, city, term,
       or entity. Do NOT use defaults.
    5. Return the .docx download link the tool produced and tell the user
       which blank indices are still unfilled so they can review.

  HARD RULES for NDAs:
  - You MUST end the turn with a .docx download link produced by
    `generate_nda`. Never tell the user to "fill the blanks manually",
    "access the template", "replace blanks yourself", or describe what the
    template contains instead of generating it. That is a failure mode.
  - If `inspect_nda_template` errors, still call `generate_nda` with the
    user's answers mapped to the labeled fields (`receiving_party`,
    `disclosing_party`, `effective_date`, `governing_city`, `term_years`,
    `purpose`). The tool will produce a .docx either way.
  - Never cite `search_knowledge_base` results as NDA "sources". The only
    NDA source is the configured template.
  - It's a draft — remind the user to have counsel review before execution.
- Produce ad-hoc Word drafts with `generate_document` for one-pagers,
  follow-up emails, briefs, etc.

Operating rules
---------------
1. Prefer grounded answers. When a user asks about a client, a past call, a
   number, a process, or anything that could live in their files, ALWAYS call
   `search_knowledge_base` first — even if you think you know the answer.
   EXCEPTION: for NDA requests, do NOT call `search_knowledge_base`. Use
   `inspect_nda_template` + `generate_nda` only — the template is the single
   source of truth; other docs must not leak into it.
2. For greetings (hi, hello, good morning, hey, etc.) or purely social
   openers, respond naturally with NO tool calls and NO citations. Do not
   search the knowledge base, do not attach sources, do not show percentages.
   Just greet back and offer to help.
3. Cite by NAME only, inline. Say "per the Optera ROI deck" or
   "the Beacon vs Competitors doc covers this" — NEVER paste URLs or
   Markdown links like [title](https://…) in your answer. The UI automatically
   renders a clean Sources block beneath your reply with clickable links, so
   inline URLs are pure noise.
3. Be concise. Bullet points for lists (use "- " at line-start), short
   paragraphs otherwise. Match the user's tone — direct, no filler.
4. If a tool returns no results, say so plainly and suggest next steps
   (e.g. "nothing in your indexed Drive — want me to draft from scratch?").
5. When generating a document, present the download link the tool returned
   and summarise what's inside in 1-2 sentences.
6. Never fabricate filenames, client quotes, or clause text. If you don't have
   grounding, say "I don't have this in your files" and stop.
7. For NDAs, remind the user it's a template draft to be reviewed by counsel.

Style
-----
Write like a sharp operator, not a chatbot. No emojis unless the user uses
them. Use Markdown sparingly — **bold** for emphasis, "- " for bullets,
headings only when the reply has real sections. Never paste raw URLs.
"""


MAX_TOOL_ITERATIONS = 6
RAG_PREVIEW_TOP_K = 4

# Short social openers where RAG grounding is noise — attaching "sources" to
# a "hi" reply makes Zippy look confused. Match is case-insensitive, on the
# stripped message, and only applies to very short inputs so real questions
# that happen to start with "hi" still go through retrieval.
_GREETING_PATTERNS = {
    "hi", "hii", "hiii", "hello", "helo", "hey", "heya", "hola", "yo", "sup",
    "good morning", "good afternoon", "good evening", "gm", "ga", "ge",
    "morning", "afternoon", "evening",
    "thanks", "thank you", "ty", "thx",
    "ok", "okay", "cool", "nice", "great",
}


def _is_greeting(text: str) -> bool:
    """True if the message is a short social opener with no real question."""
    if not text:
        return False
    cleaned = text.strip().lower().rstrip("!.?,~ ")
    if not cleaned or len(cleaned) > 30:
        return False
    # Strip trailing punctuation/emoji noise and common filler words.
    cleaned = cleaned.replace("  ", " ")
    if cleaned in _GREETING_PATTERNS:
        return True
    # Handle "hi zippy", "hey there", "hello!" variants.
    first = cleaned.split(" ", 1)[0]
    return first in _GREETING_PATTERNS and len(cleaned.split()) <= 3


async def _resolve_system_prompt(session: AsyncSession) -> str:
    """Return the admin-edited prompt from workspace_settings, or the default.

    We read once per turn — the volume is low enough (one user message → one
    lookup) that caching isn't worth the invalidation complexity. If anything
    goes wrong (table missing during a partial deploy, row empty), fall back
    to the hardcoded constant so Zippy never silently breaks.
    """
    from app.models.settings import WorkspaceSettings

    try:
        result = await session.execute(
            select(WorkspaceSettings).where(WorkspaceSettings.id == 1)
        )
        row = result.scalar_one_or_none()
        if row and (row.zippy_system_prompt or "").strip():
            return row.zippy_system_prompt.strip()
    except Exception:
        logger.exception("Failed to load zippy_system_prompt override; using default")
    return SYSTEM_PROMPT


@dataclass
class AgentTurn:
    """Result returned to the API layer."""

    conversation_id: UUID
    message_id: UUID
    content: str
    citations: list[dict] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    tool_trace: list[dict] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)


async def _load_or_create_conversation(
    session: AsyncSession,
    *,
    conversation_id: Optional[UUID],
    user_id: UUID,
    first_user_message: str,
) -> ZippyConversation:
    if conversation_id is not None:
        stmt = select(ZippyConversation).where(
            ZippyConversation.id == conversation_id,
            ZippyConversation.user_id == user_id,
        )
        result = await session.execute(stmt)
        convo = result.scalar_one_or_none()
        if convo is not None:
            return convo

    title = first_user_message.strip().split("\n")[0][:80] or "New conversation"
    convo = ZippyConversation(
        id=uuid4(),
        user_id=user_id,
        title=title,
    )
    session.add(convo)
    await session.flush()
    return convo


async def _load_recent_messages(
    session: AsyncSession,
    *,
    conversation_id: UUID,
    limit: int = 20,
) -> list[ZippyMessage]:
    stmt = (
        select(ZippyMessage)
        .where(ZippyMessage.conversation_id == conversation_id)
        .order_by(ZippyMessage.created_at.desc())
        .limit(limit)
    )
    result = await session.execute(stmt)
    messages = list(result.scalars().all())
    messages.reverse()  # chronological for the API call
    return messages


def _to_api_messages(history: list[ZippyMessage]) -> list[dict[str, Any]]:
    """Convert our stored history into Anthropic-style messages.

    We only send role + text content; prior tool traces are summarised into
    the assistant text so Claude has context without re-running tools.
    """
    api_messages: list[dict[str, Any]] = []
    for msg in history:
        role = "user" if msg.role == "user" else "assistant"
        api_messages.append(
            {
                "role": role,
                "content": [{"type": "text", "text": msg.content or ""}],
            }
        )
    return api_messages


def _format_rag_preview(snippets: list[KnowledgeSnippet]) -> str:
    if not snippets:
        return ""
    lines = [
        "Relevant snippets retrieved up-front (use tool calls if you need more):",
        "",
    ]
    for idx, snippet in enumerate(snippets, start=1):
        body = snippet.text.strip().replace("\n", " ")
        if len(body) > 400:
            body = body[:400].rstrip() + "…"
        lines.append(f"[{idx}] {snippet.source_name}: {body}")
        if snippet.drive_url:
            lines.append(f"    {snippet.drive_url}")
    return "\n".join(lines)


async def run_turn(
    session: AsyncSession,
    *,
    user_id: UUID,
    user_message: str,
    conversation_id: Optional[UUID] = None,
    source_ids: Optional[list[str]] = None,
) -> AgentTurn:
    """Run one user → assistant turn end-to-end."""
    user_message = (user_message or "").strip()
    if not user_message:
        raise ValueError("user_message cannot be empty")

    client = get_anthropic_client()
    if client is None:
        raise RuntimeError(
            "Zippy requires ANTHROPIC_API_KEY (or CLAUDE_API_KEY) to be configured."
        )

    convo = await _load_or_create_conversation(
        session,
        conversation_id=conversation_id,
        user_id=user_id,
        first_user_message=user_message,
    )

    # Persist the user turn first so partial failures still show the question.
    user_msg_row = ZippyMessage(
        id=uuid4(),
        conversation_id=convo.id,
        role="user",
        content=user_message,
    )
    session.add(user_msg_row)
    await session.flush()

    # Pre-fetch a small slice of snippets so simple questions don't need a tool
    # round-trip. The agent can still call the tool for deeper queries.
    # Skip for greetings — attaching sources to "hi" looks broken and confuses
    # the LLM into citing random docs.
    skip_rag = _is_greeting(user_message)
    if skip_rag:
        preview = []
        preview_block = ""
    else:
        preview = await search_knowledge(
            user_message,
            user_id=user_id,
            include_admin=True,
            top_k=RAG_PREVIEW_TOP_K,
            source_ids=source_ids,
        )
        preview_block = _format_rag_preview(preview)

    history = await _load_recent_messages(session, conversation_id=convo.id, limit=20)
    api_messages = _to_api_messages(history)

    # Attach preview as a contextual user note. It's invisible to the user but
    # lets Claude ground its first draft without always tool-calling.
    if preview_block:
        api_messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"[Retrieval preview for the user's question]\n{preview_block}",
                    }
                ],
            }
        )

    citations: list[dict] = []
    artifacts: list[dict] = []
    tool_trace: list[dict] = []
    # Seed citations with whatever we previewed so the UI always has context,
    # even if Claude ends up answering without an explicit tool call.
    for snippet in preview:
        citations.append(snippet.as_citation())

    final_text = ""
    active_system_prompt = await _resolve_system_prompt(session)

    for iteration in range(MAX_TOOL_ITERATIONS):
        response = await client.messages.create(
            model=settings.ZIPPY_MODEL,
            max_tokens=settings.ZIPPY_MAX_TOKENS,
            system=active_system_prompt,
            tools=TOOL_DEFINITIONS,
            messages=api_messages,
        )

        # Echo the assistant turn back into the history so Claude can see
        # the tool_use blocks it just emitted on the next iteration.
        api_messages.append(
            {"role": "assistant", "content": [block.model_dump() for block in response.content]}
        )

        tool_uses = [block for block in response.content if block.type == "tool_use"]
        text_blocks = [block for block in response.content if block.type == "text"]

        if response.stop_reason == "end_turn" or not tool_uses:
            final_text = "\n".join(block.text for block in text_blocks).strip()
            break

        # Execute every tool call in this turn, collect results.
        tool_result_blocks: list[dict[str, Any]] = []
        for call in tool_uses:
            outcome: ToolOutcome = await execute_tool(
                call.name,
                call.input or {},
                session=session,
                user_id=user_id,
            )
            tool_trace.append(
                {
                    "tool": call.name,
                    "args": call.input,
                    "is_error": outcome.is_error,
                    "result_preview": outcome.result_text[:400],
                }
            )
            citations.extend(outcome.citations)
            artifacts.extend(outcome.artifacts)
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": outcome.result_text,
                    "is_error": outcome.is_error,
                }
            )

        api_messages.append({"role": "user", "content": tool_result_blocks})
    else:
        # Hit the iteration cap — force a final text answer.
        final_text = (
            "I got stuck in a tool loop — here's what I found so far. "
            "Try rephrasing the question with more specifics."
        )

    if not final_text:
        final_text = "(No response generated.)"

    # De-dupe citations + artifacts by source/url so the UI doesn't repeat.
    citations = _dedupe_by_key(citations, key="source_id")
    artifacts = _dedupe_by_key(artifacts, key="url")

    assistant_msg = ZippyMessage(
        id=uuid4(),
        conversation_id=convo.id,
        role="assistant",
        content=final_text,
        citations=citations or None,
        artifacts=artifacts or None,
        tool_trace=tool_trace or None,
    )
    session.add(assistant_msg)

    # Bump conversation updated_at so the sidebar re-sorts.
    convo.updated_at = datetime.utcnow()
    session.add(convo)
    await session.commit()

    return AgentTurn(
        conversation_id=convo.id,
        message_id=assistant_msg.id,
        content=final_text,
        citations=citations,
        artifacts=artifacts,
        tool_trace=tool_trace,
        created_at=assistant_msg.created_at,
    )


def _dedupe_by_key(items: list[dict], *, key: str) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        k = str(item.get(key, ""))
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(item)
    return out
