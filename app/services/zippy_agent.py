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
- Generate Minutes of Meeting (MOM) documents with `generate_mom`.
- Draft NDAs for India / US / Singapore with `generate_nda` (templates only,
  never legal advice).
- Produce ad-hoc Word drafts with `generate_document` for one-pagers,
  follow-up emails, briefs, etc.

Operating rules
---------------
1. Prefer grounded answers. When a user asks about a client, a past call, a
   number, a process, or anything that could live in their files, ALWAYS call
   `search_knowledge_base` first — even if you think you know the answer.
2. Cite by NAME only, inline. Say "per the Optera ROI deck" or
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

    for iteration in range(MAX_TOOL_ITERATIONS):
        response = await client.messages.create(
            model=settings.ZIPPY_MODEL,
            max_tokens=settings.ZIPPY_MAX_TOKENS,
            system=SYSTEM_PROMPT,
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
