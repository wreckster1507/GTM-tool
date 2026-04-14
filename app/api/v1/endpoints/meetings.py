import json
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.core.dependencies import CurrentUser, DBSession, Pagination
from app.models.meeting import Meeting, MeetingCreate, MeetingRead, MeetingUpdate
from app.repositories.meeting import MeetingRepository
from app.services.permissions import require_workspace_permission
from app.schemas.common import PaginatedResponse

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("/", response_model=PaginatedResponse[MeetingRead])
async def list_meetings(
    session: DBSession,
    pagination: Pagination,
    company_id: Optional[UUID] = Query(default=None),
    deal_id: Optional[UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    repo = MeetingRepository(session)
    filters = []
    if company_id:
        filters.append(Meeting.company_id == company_id)
    if deal_id:
        filters.append(Meeting.deal_id == deal_id)
    if status:
        filters.append(Meeting.status == status)
    items, total = await repo.list_paginated(
        *filters,
        skip=pagination.skip,
        limit=pagination.limit,
        order_by=Meeting.scheduled_at.desc(),
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=MeetingRead, status_code=201)
async def create_meeting(payload: MeetingCreate, session: DBSession):
    return await MeetingRepository(session).create(payload.model_dump())


@router.get("/{meeting_id}", response_model=MeetingRead)
async def get_meeting(meeting_id: UUID, session: DBSession):
    return await MeetingRepository(session).get_or_raise(meeting_id)


@router.put("/{meeting_id}", response_model=MeetingRead)
async def update_meeting(meeting_id: UUID, payload: MeetingUpdate, session: DBSession):
    repo = MeetingRepository(session)
    meeting = await repo.get_or_raise(meeting_id)
    update_data = payload.model_dump(exclude_unset=True)
    update_data["updated_at"] = datetime.utcnow()
    return await repo.update(meeting, update_data)


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(meeting_id: UUID, session: DBSession):
    repo = MeetingRepository(session)
    meeting = await repo.get_or_raise(meeting_id)
    await repo.delete(meeting)


@router.post("/{meeting_id}/pre-brief")
async def generate_pre_brief(meeting_id: UUID, session: DBSession, current_user: CurrentUser):
    """Generate AI pre-meeting brief combining company research + attendee profiles."""
    await require_workspace_permission(session, current_user, "run_pre_meeting_intel")

    repo = MeetingRepository(session)
    meeting = await repo.get_or_raise(meeting_id)

    from app.services.pre_meeting import generate_account_brief
    brief_text = ""

    if meeting.company_id:
        company_brief = await generate_account_brief(meeting.company_id, session)
        brief_text += company_brief.get("brief") or ""

    if meeting.attendees:
        attendee_ids = [a.get("contact_id") for a in meeting.attendees if a.get("contact_id")]
        if attendee_ids:
            from app.services.contact_intelligence import generate_contact_brief
            attendee_briefs = []
            for cid in attendee_ids[:3]:
                try:
                    cb = await generate_contact_brief(UUID(cid), session)
                    if cb.get("brief"):
                        name = cb.get("contact_name", "")
                        attendee_briefs.append(
                            f"\n--- {name} ({cb.get('title', '')}) ---\n{cb['brief']}"
                        )
                except Exception:
                    pass
            if attendee_briefs:
                brief_text += "\n\nSTAKEHOLDER PROFILES:" + "".join(attendee_briefs)

    meeting.pre_brief = brief_text
    meeting.updated_at = datetime.utcnow()
    await repo.save(meeting)
    return {"meeting_id": str(meeting_id), "pre_brief": brief_text}


@router.post("/{meeting_id}/intelligence")
async def run_meeting_intelligence(meeting_id: UUID, session: DBSession, current_user: CurrentUser):
    """
    Full pre-meeting intelligence: website scrape, DuckDuckGo news/signals,
    Hunter contacts, Google News, competitive landscape, GPT-4o executive
    briefing. Saves to meeting.research_data. ~10-15s.
    """
    await require_workspace_permission(session, current_user, "run_pre_meeting_intel")

    import logging
    logger = logging.getLogger(__name__)
    from app.services.pre_meeting_intelligence import run_pre_meeting_intelligence
    try:
        result = await run_pre_meeting_intelligence(meeting_id, session)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Pre-meeting intelligence failed for {meeting_id}")
        raise HTTPException(status_code=500, detail=f"Intelligence run failed: {str(e)}")


@router.post("/{meeting_id}/demo-strategy")
async def generate_demo_strategy(meeting_id: UUID, session: DBSession, current_user: CurrentUser):
    """
    GPT-4o Demo Strategy & Story Lineup. Reads cached research_data (if intel
    was already run) plus company DB profile. Saves to meeting.demo_strategy.
    """
    await require_workspace_permission(session, current_user, "run_pre_meeting_intel")

    import logging
    logger = logging.getLogger(__name__)
    from app.services.pre_meeting_intelligence import generate_meeting_demo_strategy
    try:
        result = await generate_meeting_demo_strategy(meeting_id, session)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Demo strategy generation failed for {meeting_id}")
        raise HTTPException(status_code=500, detail=f"Demo strategy failed: {str(e)}")


@router.post("/{meeting_id}/research-more")
async def research_more(meeting_id: UUID, session: DBSession, current_user: CurrentUser):
    """
    Gap-filling enrichment: detects what's missing in the company's enrichment_cache
    and only fetches those pieces (Hunter firmographics, contacts, Google News, etc.).
    Much faster than running full web intel — only fills actual gaps.
    """
    await require_workspace_permission(session, current_user, "run_pre_meeting_intel")

    import logging
    logger = logging.getLogger(__name__)
    from app.services.pre_meeting_intelligence import run_research_more
    try:
        result = await run_research_more(meeting_id, session)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Research more failed for {meeting_id}")
        raise HTTPException(status_code=500, detail=f"Research more failed: {str(e)}")


@router.get("/{meeting_id}/research-gaps")
async def get_research_gaps(meeting_id: UUID, session: DBSession, current_user: CurrentUser):
    """
    Returns a list of data gaps for the meeting's company — what's missing
    so the frontend can show 'Research More (N gaps)' without running anything.
    """
    from app.models.meeting import Meeting
    from app.models.company import Company
    from datetime import datetime

    meeting = await session.get(Meeting, meeting_id)
    if not meeting or not meeting.company_id:
        return {"gaps": [], "count": 0}

    company = await session.get(Company, meeting.company_id)
    if not company:
        return {"gaps": [], "count": 0}

    import re as _re
    ec = company.enrichment_cache if isinstance(company.enrichment_cache, dict) else {}
    now = datetime.utcnow()
    gaps = []

    # Strip CRM suffixes to get real company name for news/search queries
    raw_name = company.name or ""
    clean_name = _re.sub(r'\s*-\s*(Impl|Skilljar|CS|Pilot|Trial|POC|Demo|Test)\s*$', '', raw_name, flags=_re.IGNORECASE).strip() or raw_name

    def _unwrap(key):
        entry = ec.get(key)
        return entry.get("data") if isinstance(entry, dict) else None

    def _age_days(key) -> float:
        entry = ec.get(key)
        if not isinstance(entry, dict):
            return 9999
        fetched_at = entry.get("fetched_at")
        if not fetched_at:
            return 9999
        try:
            d = datetime.fromisoformat(fetched_at)
            return (now - d).total_seconds() / 86400
        except Exception:
            return 9999

    def _has_contacts() -> bool:
        data = _unwrap("hunter_contacts")
        if isinstance(data, list):
            return len(data) > 0
        if isinstance(data, dict):
            return len(data.get("contacts", [])) > 0
        return False

    domain = company.domain or ""

    if not _unwrap("hunter_company") and domain and not domain.endswith(".unknown"):
        gaps.append({"key": "hunter_company", "label": "Company firmographics (revenue, tech stack, size)"})

    hc_entry = ec.get("hunter_contacts")
    hc_paused = isinstance(hc_entry, dict) and hc_entry.get("paused")
    if (not _has_contacts() or hc_paused) and domain and not domain.endswith(".unknown"):
        gaps.append({"key": "hunter_contacts", "label": "Verified contacts with seniority & department"})

    if not _unwrap("google_news") or _age_days("google_news") > 7:
        if clean_name:
            gaps.append({"key": "google_news", "label": f"Latest news about {clean_name}"})

    if not _unwrap("web_scrape") and domain and not domain.endswith(".unknown"):
        gaps.append({"key": "web_scrape", "label": "Website content (pricing, product, careers)"})

    if not ec.get("competitive_landscape_v2") and clean_name:
        gaps.append({"key": "competitive_landscape", "label": "Competitive landscape"})

    icp_raw = _unwrap("icp_analysis")
    icp_data = icp_raw.get("data") if isinstance(icp_raw, dict) and "data" in icp_raw else icp_raw
    if isinstance(icp_data, dict):
        missing_icp = []
        if not icp_data.get("conversation_starter"):
            missing_icp.append("conversation starter")
        if not icp_data.get("why_now"):
            missing_icp.append("why now")
        if missing_icp:
            gaps.append({"key": "icp_fields", "label": f"AI-generated {', '.join(missing_icp)}"})

    return {"gaps": gaps, "count": len(gaps)}


@router.post("/{meeting_id}/post-score")
async def generate_post_score(meeting_id: UUID, payload: dict, session: DBSession):
    """Score a meeting from raw notes and generate MoM draft."""
    repo = MeetingRepository(session)
    meeting = await repo.get_or_raise(meeting_id)

    raw_notes = payload.get("raw_notes") or meeting.raw_notes or ""
    if not raw_notes:
        raise HTTPException(
            status_code=400,
            detail="raw_notes required in body or already saved on meeting",
        )

    from app.clients.azure_openai import AzureOpenAIClient
    from app.models.company import Company

    ai = AzureOpenAIClient()
    company_name = "the company"
    if meeting.company_id:
        co = await session.get(Company, meeting.company_id)
        if co:
            company_name = co.name

    if ai.mock:
        result_data = {
            "meeting_score": 72,
            "what_went_right": "Good rapport established. Prospect engaged with the demo.",
            "what_went_wrong": "Did not address budget timeline clearly.",
            "next_steps": "Send pricing deck by EOD. Schedule technical deep-dive.",
            "mom_draft": (
                f"Hi team,\n\nThank you for your time today discussing {company_name}.\n\n"
                "Key takeaways:\n• [Summary from notes]\n\nNext steps:\n• Send pricing deck\n\n"
                "Best,\n[Your name]"
            ),
        }
    else:
        system = (
            "You are a sales coach analysing a meeting debrief. "
            "Respond in JSON only with keys: meeting_score (int 0-100), "
            "what_went_right (string), what_went_wrong (string), "
            "next_steps (string), mom_draft (professional email string)."
        )
        user = (
            f"Company: {company_name}\nMeeting type: {meeting.meeting_type}\n"
            f"Meeting notes:\n{raw_notes[:2000]}\n\nAnalyse and return JSON as specified."
        )
        raw = await ai.complete(system, user, max_tokens=700)
        try:
            result_data = json.loads(raw or "{}")
        except Exception:
            result_data = {"meeting_score": 50, "mom_draft": raw or ""}

    meeting.raw_notes = raw_notes
    meeting.meeting_score = result_data.get("meeting_score")
    meeting.what_went_right = result_data.get("what_went_right")
    meeting.what_went_wrong = result_data.get("what_went_wrong")
    meeting.next_steps = result_data.get("next_steps")
    meeting.mom_draft = result_data.get("mom_draft")
    meeting.status = "completed"
    meeting.updated_at = datetime.utcnow()
    await repo.save(meeting)

    return {"meeting_id": str(meeting_id), **result_data}
