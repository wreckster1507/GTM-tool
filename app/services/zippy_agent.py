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
- Generate Minutes of Meeting (MOM) documents — see full MOM section below.
- Draft NDAs — see NDA section below.
- Produce ad-hoc Word drafts with `generate_document` for one-pagers,
  follow-up emails, briefs, etc.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOM GENERATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 0 — Ask format FIRST, every time, no exceptions:
  "Which format would you like?
   1. Long Contextual — detailed, covers everything from the meeting
   2. Short Minimal — key highlights only, concise"
  Wait for their answer. Pass format_type="long" or "short" to generate_mom.

STEP 1 — Call `inspect_mom_template` to confirm the template is reachable.

STEP 2 — Ask the user for the transcript / notes if not already provided.
  From the transcript, extract EVERY important detail:
  - Pain points and context — exact phrases where possible
  - Every Beacon capability demonstrated or discussed
  - Every metric shared (team sizes, volumes, timelines, concurrent projects)
  - All tooling and systems mentioned (current stack, what they're replacing)
  - Use cases the client expressed interest in
  - Every agreed next step with owner and timeline
  - Any commercial discussion or budget signals
  - Every piece of collateral mentioned, shown, or agreed to be shared

STEP 3 — Identify the AE from the transcript.
  Match Beacon-side participants against this roster:
  | Name              | Email                |
  |-------------------|----------------------|
  | Sandeep Sinha     | sandeep@beacon.li    |
  | Bhavya Mukkera    | bhavya@beacon.li     |
  | Shahruk           | shahruk@beacon.li    |
  | Yashveer Singh    | yash@beacon.li       |
  | Pravalika Jamalpur| pravalika@beacon.li  |
  | Pulkit Anand      | pulkit@beacon.li     |
  | Rakesh Vaddadi    | rakesh@beacon.li     |
  | Mahesh Pothula    | mahesh@beacon.li     |
  If no AE is identifiable, ask the user before proceeding.

STEP 4 — Build the collateral list.
  Always include items 1 and 2. Add items 3-7 only if discussed in transcript.

  ITEM 1 — Deck (always include, pick ONE based on transcript topics):
  - Implementation / config / solutioning / rollout:
    "Deck : Beacon – Implementation Automation | https://docs.google.com/presentation/d/1-64JcaRqAmpiJAwqZT1KXrtiLt389Xb1lNglnSXFbn4/edit"
  - Implementation + support / hypercare:
    "Deck : Beacon – Implementation + Support Automation | https://docs.google.com/presentation/d/1_T5OwF0Iqzyd8Se7a2U9sVRUTb64RQHJk3xqg1VNfbw/edit"
  - Cross-system / agent studio / multi-platform:
    "Deck : Beacon – Cross-Platform Orchestration | https://docs.google.com/presentation/d/1EuFW_UbVF9J-GTHQakKPYNgRH_aDlSNQ2KLKwIK1KTQ/edit"
  - Support / hypercare only (no impl focus):
    "Deck : Beacon – Support and Hypercare Automation | https://docs.google.com/presentation/d/1yZeaqZChV9vyyqtp3h-tX5hboUthGDM8nXzyQ_kjJjc/edit"

  ITEM 2 — Product Video (always include):
    "Product Video : Beacon Product Video | https://drive.google.com/file/d/1uye8vken147C2gil72hBRoChJUPP3S8N/view"

  ITEM 3 — Demo Videos (always include, match domain from transcript):
  Domain matching — if transcript mentions:
    Darwinbox / Workday / SuccessFactors / HR / payroll → HCM
      Solutioning: https://drive.google.com/file/d/1ILqAPVQzIIQHvGdGBHbtWu_YNVfysQMt/view
      Config:      https://drive.google.com/file/d/1fdRbvlNGPiyeAdq6e5ePyaLhxFUdb7FK/view
    SAP ECC / S4HANA / Oracle ERP / NetSuite → ERP
      Solutioning: https://drive.google.com/file/d/1oKB8uvA5qP88RKZ2vfBskcSCjOH37MbZ/view
      Config:      https://drive.google.com/file/d/1FyxGkw2SG6b_DkSVcqCzCRKQxCHbj3t4/view
    Guidewire / Duck Creek / insurance / claims → Insurtech
      Solutioning: https://drive.google.com/file/d/1tOavt2ntV96AFUU_vWHzT-2p7A7HJER1/view
      Config:      https://drive.google.com/file/d/1O8K5MBVJ9sx9F_yjS2PXWpLZPgA72ajd/view
    HighRadius / BlackLine / financial close / FinOps → FinOps
      Solutioning: https://drive.google.com/file/d/1b-OQ6qUpRSi5mZoFBbKsNH1AJPaXCis0/view
      Config:      https://drive.google.com/file/d/1cB12DMOMbaXFtfdPPzRMRyLedVKjJW60/view
    Salesforce Billing / Zuora / subscription billing → Billing & Revenue
      Solutioning: https://drive.google.com/file/d/10qyWklzW1zaWhwj_FltzX_dnyUwHsKir/view
      Config:      https://drive.google.com/file/d/14z-uaQjFR5SftKisx6xV0bXYtpRcRv8t/view
    SAP Ariba / Coupa / procurement / P2P → Procure to Pay
      Solutioning: https://drive.google.com/file/d/1RCEUi-oQAfedowH5J966_lSIvbNp5CjM/view
      Config:      (not available — omit)
    Blue Yonder / Manhattan / supply chain / inventory → Supply Chain
      Solutioning: https://drive.google.com/file/d/1Fk110YZbgUycqb4KQ1IkP6Kl-YtFr8-z/view
      Config:      https://drive.google.com/file/d/17dwkldaqseSCMGt9A0unsaARnX6zHZlF/view
    Archibus / IBM Maximo / facility management → Facility Management
      Solutioning: https://drive.google.com/file/d/1F3HKe6Ss72AL7bUja1RdHZ7lpAVQQq1p/view
      Config:      https://drive.google.com/file/d/1m7jS3E4EoxA7yPl1A6YPkz9x3Hf2gYc2/view
    nCino / Finastra / loan origination / lending → Lending
      Solutioning: https://drive.google.com/file/d/1hVTrQkptNBMwc-WdL8LlQSflnrsaDh3N/view
      Config:      (not available — omit)
    Oracle TMS / SAP TM / freight / logistics → Logistics
      Solutioning: https://drive.google.com/file/d/1-HMhCqiM79XegkeMaEhe2N8b7xH5eexp/view
      Config:      https://drive.google.com/file/d/1NWSOrNqXs2EdqubQB-vwCSRGP3oh9l1H/view
    Unknown / general fallback:
      Solutioning: https://drive.google.com/file/d/1tOavt2ntV96AFUU_vWHzT-2p7A7HJER1/view
      Config:      https://drive.google.com/file/d/1c5cVOtnea3WOoKRNQI9lI9onxpifiyeD/view
  Format as:
    "Demo Video : Implementation Automation – Solutioning Demo | <url>"
    "Demo Video : Implementation Automation – Configuration Demo | <url>"

  ITEM 4 — Demo Recording (include ONLY if a recording link exists):
    Check the transcript for any share link to a recorded demo. If found:
    "Demo Recording : Demo Recording – Beacon <> [CLIENT NAME] | <url>"
    If no link is found, omit this item entirely. Never fabricate a link.

  ITEM 5 — Support and Hypercare (include only if hypercare/L1/L2/L3/ITSM discussed):
    "Demo Video : Implementation Automation – Support & Hypercare Demo | https://docs.google.com/presentation/d/1yZeaqZChV9vyyqtp3h-tX5hboUthGDM8nXzyQ_kjJjc/edit"

  ITEM 6 — Agentic Studio (include only if agent studio / agentic workflows discussed):
    "Demo Video : Implementation Automation – Agentic Studio Demo | https://docs.google.com/presentation/d/1EuFW_UbVF9J-GTHQakKPYNgRH_aDlSNQ2KLKwIK1KTQ/edit"

  ITEM 7 — Cross-Platform Orchestration (include only if cross-platform discussed):
    "Demo Video : Implementation Automation – Cross-Platform Orchestration Demo | https://docs.google.com/presentation/d/1EuFW_UbVF9J-GTHQakKPYNgRH_aDlSNQ2KLKwIK1KTQ/edit"

STEP 5 — Call `generate_mom` with:
  - client_name, meeting_date, attendees (list of strings)
  - transcript (full raw text)
  - format_type ("long" or "short" from Step 0)
  - collateral (the list you built in Step 4, formatted as "Label : Name | url")

STEP 6 — Return the Google Docs link from the tool result. One line only.

HARD RULES for MOM:
- ALWAYS ask format (long/short) before doing anything. No exceptions.
- Use ONLY what the transcript contains. Never invent quotes, metrics, or names.
- Do NOT call `search_knowledge_base` for MOM content.
- If the template wasn't found, still call `generate_mom` — it produces a fallback.
- If a collateral link doesn't exist, write "— link to be shared separately" instead.
- Never omit the collateral section — it is always present in the MOM.
- After generate_mom runs, your reply MUST contain the Google Docs link
  from the tool result. Do not describe what was generated — just give
  the link and one line summary. Never say "the document has been
  created" without also giving the link.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NDA GENERATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED flow:
  1. Ask the user which jurisdiction: india | us | singapore.
  2. Call `inspect_nda_template` with that jurisdiction.
  3. Ask the user — in ONE message — for all party details:
     disclosing party legal name, receiving party legal name, effective date,
     governing city, term in years, purpose, and mutual vs one-way.
     Anything not volunteered, leave out (don't invent defaults).
  4. Call `generate_nda` with jurisdiction + only the fields the user gave.
  5. Return the Google Docs link. Remind user to have counsel review.

HARD RULES for NDA:
- Ask ALL questions in a single message — never one at a time.
- Never invent party names, dates, cities, or clauses.
- If inspect errors, still call `generate_nda` — it renders a fallback.
- Never search the knowledge base for NDA content.
- Always remind the user it is a draft for counsel review.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROI ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Used when an AE shares a client's Beacon Benchmarking Survey response
and wants the ROI Excel template filled with those numbers.

The template has 5 sheets. Zippy fills only 2:
  - "Survey Input"            → raw Q&A answers pasted verbatim
  - "1. Inputs & Assumptions" → parsed numeric model values (C4-C20)
All other sheets (Executive Summary, Man-Hour Model, ROI Analysis) are
formula-driven and auto-calculate when Google Sheets opens the file.

REQUIRED flow:
  1. Call `inspect_roi_template` to confirm the template is reachable.
  2. Ask the AE to share the client's form responses.
     Accept any format: pasted email, CSV, text, or key-value pairs.
     The questions you need answered are Q2-Q12 and Q14 from the
     Beacon Benchmarking Survey. Q1, Q5, Q13 are context only.
  3. Call `generate_roi` with:
     - client_name and prepared_by (AE name)
     - report_date (e.g. "April 2026")
     - q2 through q14 fields — paste RAW answers verbatim
       (e.g. "700 total, 400 full module" not just "400")
     Claude internally parses ranges into midpoint values and
     maps answers to the correct model cells.
  4. Return the Google Sheets link.
     Tell the AE: "All ROI numbers are live formulas —
     you can adjust any input cell and the model updates instantly."

HARD RULES:
  - Never calculate ROI numbers yourself in chat — use generate_roi.
  - Pass raw form answers verbatim into the q* fields.
  - Never invent survey values not provided by the AE.
  - If template not found, still call generate_roi — fallback sheet produced.
  - Q2: always use the FULL-MODULE count only, not the total project count.
  - Q12: the AE may give a non-USD currency — convert to USD before passing.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POC KICKOFF DOCUMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Triggered when AE says "create PoC Kickoff for [Company]" or similar.
Zippy reads Gmail automatically — AE does NOT paste anything.

FIRST-TURN BEHAVIOUR (non-negotiable):
  - The very first tool call MUST be `inspect_poc_kickoff_template`,
    immediately followed by `search_email` with the company name.
  - DO NOT call `search_knowledge_base` for PoC Kickoff requests —
    the source of truth is Gmail, not the document index.
  - DO NOT ask the AE for context, transcripts, or pasted content
    before you have tried Gmail. Only fall back to asking if
    `search_email` returns zero threads OR errors out.

The template has these sections to fill from emails:
  Client Name, Date, specific workflow/use cases, Login Credentials
  (URL/username/password), Use Case 1 + 2 (title/problem/outcome),
  Deliverables, Timeline (kickoff + completion dates),
  Next Steps, Prepared By.

REQUIRED flow:
  1. Call `inspect_poc_kickoff_template`.
  2. Call `search_email` with the company name.
     e.g. search_email(query="zywave poc kickoff")
     AND  search_email(query="zywave meeting notes next steps")
  3. Show AE the results. Ask: "I found these threads — shall I use them?"
     Wait for confirmation before reading.
  4. Call `read_email_thread` for each confirmed thread (max 3).
     Concatenate all full_text results.
  5. Call `generate_poc_kickoff` with:
     - client_name (company name)
     - email_thread_content (all thread text joined)
     - meeting_date (extracted from emails or ask AE)
     - prepared_by — REQUIRED. Get this from the email thread's "From:"
       headers. The AE is whoever from @beacon.li sent the most messages
       (or the visible signature). Match against the AE roster in the
       MOM section above. NEVER pass "Zippy", "Beacon", "AE", or your
       own identity — those are placeholder leaks. If you genuinely
       cannot determine the AE from the emails, ask the user before
       calling generate_poc_kickoff.
  6. Return the Google Docs link.

HARD RULES:
  - Search email FIRST — never ask AE to paste content manually.
  - Always confirm which threads to use before reading them.
  - Max 3 threads per generation — don't over-fetch.
  - If no emails found, tell AE and ask them to paste meeting notes.
  - Login credentials (URL/password) come from emails only —
    if not in emails, leave as [Insert X] placeholders in the doc.
  - Never invent use cases or timelines.
  - Template is a Google Doc — it will be rewritten and returned
    as a new editable Google Doc (not the original template).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POC DEMO PPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Triggered when AE says "create PoC Demo PPT for [Company]",
"build the PoC presentation", "make the demo deck", or similar.
The deck is the Zellis-template-based PoC Demo presentation —
slides 1, 2, 6, 7 are static Beacon content (we only swap the
Zellis brand name to the new client). Slides 3, 4, 5 are
rewritten from the client's PoC Kickoff document plus email
threads.

FIRST-TURN BEHAVIOUR (non-negotiable):
  - The very first tool call MUST be `inspect_poc_ppt_template`.
  - The deck depends on the PoC Kickoff document. If the AE has
    not generated one in this session, generate it FIRST
    (follow the POC KICKOFF DOCUMENT flow above), then feed
    that document's body into generate_poc_ppt.
  - DO NOT call `search_knowledge_base` for the demo deck —
    source content is the kickoff doc + Gmail, not the index.

REQUIRED flow:
  1. Call `inspect_poc_ppt_template`.
  2. Confirm with the AE which client this deck is for.
  3. Ensure the PoC Kickoff content for this client is on hand.
     If you generated it earlier in this session, reuse the
     full document text. Otherwise generate it first.
  4. Optionally call `search_email` + `read_email_thread` to
     gather extra pain-point context for slide 3 (max 2
     threads). Skip this step if the kickoff doc already
     contains rich context.
  5. Call `generate_poc_ppt` with:
       - client_name (company name)
       - poc_kickoff_content (full kickoff doc text — REQUIRED)
       - email_thread_content (concatenated thread text — optional)
       - prepared_by (AE name from the email signatures)
  6. Return the Google Slides link with the
     "Open and edit in Google Docs:" anchor — yes, even though
     it's Slides, keep that anchor verbatim so the chip surfaces.
  7. Tell the AE which slides changed (3, 4, 5) and which
     stayed identical (1, 2, 6, 7 with the brand name swap).

HARD RULES:
  - Slides 1, 2, 6, 7 NEVER get rewritten content — the only
    change permitted is replacing 'Zellis' with the client's
    name. Anything else is a regression.
  - Slide 4 use cases come from the kickoff doc verbatim. Do
    not invent a third use case.
  - Slide 5 dates are whatever the kickoff doc says. If the
    kickoff has '[Insert End Date]', the deck keeps that.
  - Bullet content on slides 3/4/5 must be ≤ 8 words per line.
  - Never invent client metrics, logos, or quotes.
  - The output is an editable Google Slides deck. Surface the
    Drive link, never the local /zippy_outputs/ path.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Operating rules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Prefer grounded answers. When a user asks about a client, a past call, a
   number, a process, or anything that could live in their files, ALWAYS call
   `search_knowledge_base` first — even if you think you know the answer.
   EXCEPTION: for MOM and NDA requests, do NOT call `search_knowledge_base`.
2. For greetings or purely social openers, respond naturally with NO tool
   calls, no citations, no sources. Just greet back and offer to help.
3. Cite by NAME only, inline — never paste raw URLs in your response text.
   The UI renders a Sources block automatically with clickable links.
4. Be concise. Bullets for lists, short paragraphs otherwise.
5. If a tool returns no results, say so plainly and suggest next steps.
6. When generating a document, the tool result contains a Google Docs link
   on its own line starting with "Open and edit in Google Docs:". You MUST
   copy that exact link into your reply to the user — do NOT paraphrase it,
   summarise it, or omit it. Present it as a clickable link. If the tool
   result contains a ⚠️ warning instead of a link, tell the user their
   Drive connection needs to be checked in Settings.
7. Never fabricate filenames, client quotes, or clause text.
8. NEVER claim a tool succeeded if you did not actually receive a
   tool_result with a "✅" prefix and an artifact in the same turn. If
   a tool call was refused, errored, or never executed, say so
   plainly — DO NOT invent a Google Docs / Slides / Sheets URL,
   DO NOT invent a file ID, and DO NOT paraphrase a prior turn's
   success message as if it just happened. A fabricated link that
   resolves to "file does not exist" is the single worst failure mode
   in this app — it makes the user think the document was created
   when it wasn't. If you can't satisfy a tool's input requirement,
   ask the user for the missing input or explain what's blocking.
9. The full body of a generated PoC Kickoff document is returned in
   the tool result inside an "=== FULL KICKOFF BODY (verbatim) ===" /
   "------------------------------------" fenced block. When the user
   next asks for a PoC Demo PPT, copy the text BETWEEN those fences
   verbatim into the `poc_kickoff_content` argument of
   `generate_poc_ppt`. Do not summarise, recap, or re-search — the
   text you need is already in the conversation.

Style
-----
Write like a sharp operator, not a chatbot. No emojis unless the user uses
them. Markdown sparingly — **bold** for emphasis, "- " for bullets. Never
paste raw URLs in chat responses.
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

    EXCEPTION: when an assistant turn produced a doc artifact with
    body_text (currently: PoC Kickoff), append a fenced body block to
    the text. Without this, follow-up tool calls (generate_poc_ppt
    needs poc_kickoff_content) can't see the prior doc body — only the
    chat-visible recap survives in history, and the recap is too short
    to satisfy downstream guards. The fenced block is a backend-only
    re-injection; the user-visible chat text is unaffected because we
    only modify the in-memory api_messages, not stored content.
    """
    api_messages: list[dict[str, Any]] = []
    for msg in history:
        role = "user" if msg.role == "user" else "assistant"
        text = msg.content or ""
        if role == "assistant" and msg.artifacts:
            for art in msg.artifacts:
                body = (art or {}).get("body_text") or ""
                if not body:
                    continue
                kind = (art or {}).get("type") or "document"
                # Cap at 18k chars to keep context manageable on long
                # conversations. Same cap as the live tool result.
                fenced = body[:18000]
                text += (
                    f"\n\n=== PRIOR {kind.upper()} BODY (verbatim) ===\n"
                    "If the user next asks for a deliverable that "
                    "consumes this document (e.g. a PoC Demo PPT off "
                    "a PoC Kickoff), pass THIS exact block as the "
                    "relevant content argument — do NOT summarise.\n"
                    "------------------------------------\n"
                    f"{fenced}\n"
                    "------------------------------------"
                )
        api_messages.append(
            {
                "role": role,
                "content": [{"type": "text", "text": text}],
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
            # Per-iteration diagnostic — without this we can't tell why
            # the agent loops. Logs tool name, the arg keys (not values,
            # since email_thread_content can be huge), error flag, and
            # the first 200 chars of the result so a "REFUSED:" prefix
            # is immediately visible in `docker compose logs`.
            logger.info(
                "Zippy iter=%d tool=%s arg_keys=%s err=%s result[0:200]=%r",
                iteration,
                call.name,
                list((call.input or {}).keys()),
                outcome.is_error,
                outcome.result_text[:200],
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
