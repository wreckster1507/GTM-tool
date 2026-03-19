"""
Meeting routes — full meeting lifecycle management.

Endpoints:
  GET    /meetings/                         — list meetings (filter by company/deal)
  POST   /meetings/                         — create a meeting
  GET    /meetings/{meeting_id}            — get meeting detail
  PUT    /meetings/{meeting_id}            — update meeting
  DELETE /meetings/{meeting_id}            — delete meeting

  POST   /meetings/{meeting_id}/pre-brief  — generate AI pre-meeting brief
  POST   /meetings/{meeting_id}/post-score — generate AI post-meeting score + MoM from raw notes
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.meeting import Meeting, MeetingCreate, MeetingRead, MeetingUpdate

router = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get("/", response_model=List[MeetingRead])
async def list_meetings(
    company_id: Optional[UUID] = Query(default=None),
    deal_id: Optional[UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    query = select(Meeting)
    if company_id:
        query = query.where(Meeting.company_id == company_id)
    if deal_id:
        query = query.where(Meeting.deal_id == deal_id)
    if status:
        query = query.where(Meeting.status == status)
    query = query.order_by(Meeting.scheduled_at.desc()).offset(skip).limit(limit)
    result = await session.execute(query)
    return result.scalars().all()


@router.post("/", response_model=MeetingRead, status_code=201)
async def create_meeting(
    payload: MeetingCreate,
    session: AsyncSession = Depends(get_session),
):
    meeting = Meeting(**payload.model_dump())
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)
    return meeting


@router.get("/{meeting_id}", response_model=MeetingRead)
async def get_meeting(
    meeting_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.put("/{meeting_id}", response_model=MeetingRead)
async def update_meeting(
    meeting_id: UUID,
    payload: MeetingUpdate,
    session: AsyncSession = Depends(get_session),
):
    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(meeting, key, value)
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)
    return meeting


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(
    meeting_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    await session.delete(meeting)
    await session.commit()


@router.post("/{meeting_id}/pre-brief")
async def generate_pre_brief(
    meeting_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Generate an AI pre-meeting brief.
    Pulls company data + recent signals + attendee profiles and synthesises with GPT-4o.
    Saves the brief back to the meeting record.
    """
    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    from app.services.pre_meeting import generate_account_brief
    from app.models.signal import Signal
    from app.models.contact import Contact

    brief_text = ""

    # Company brief
    if meeting.company_id:
        company_brief = await generate_account_brief(meeting.company_id, session)
        brief_text += company_brief.get("brief") or ""

    # Attendee summaries (contacts)
    if meeting.attendees:
        attendee_ids = [a.get("contact_id") for a in meeting.attendees if a.get("contact_id")]
        if attendee_ids:
            from app.services.contact_intelligence import generate_contact_brief
            attendee_briefs = []
            for cid in attendee_ids[:3]:  # max 3 contacts to limit latency
                try:
                    cb = await generate_contact_brief(UUID(cid), session)
                    if cb.get("brief"):
                        name = cb.get("contact_name", "")
                        attendee_briefs.append(f"\n--- {name} ({cb.get('title', '')}) ---\n{cb['brief']}")
                except Exception:
                    pass
            if attendee_briefs:
                brief_text += "\n\nSTAKEHOLDER PROFILES:" + "".join(attendee_briefs)

    meeting.pre_brief = brief_text
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)
    return {"meeting_id": str(meeting_id), "pre_brief": brief_text}


@router.post("/{meeting_id}/post-score")
async def generate_post_score(
    meeting_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    """
    After a meeting, generate:
      - AI meeting score (0-100)
      - What went right / wrong
      - Next steps
      - Minutes of Meeting (MoM) email draft

    Body: { "raw_notes": "..." }  — paste your meeting notes here.
    """
    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    raw_notes = payload.get("raw_notes") or meeting.raw_notes or ""
    if not raw_notes:
        raise HTTPException(status_code=400, detail="raw_notes required in body or already saved on meeting")

    from app.clients.azure_openai import AzureOpenAIClient
    ai = AzureOpenAIClient()

    company_name = "the company"
    if meeting.company_id:
        from app.models.company import Company
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
            f"Company: {company_name}\n"
            f"Meeting type: {meeting.meeting_type}\n"
            f"Meeting notes:\n{raw_notes[:2000]}\n\n"
            "Analyse this meeting and return JSON as specified."
        )
        import json
        raw_response = await ai.complete(system, user, max_tokens=700)
        try:
            result_data = json.loads(raw_response or "{}")
        except Exception:
            result_data = {"meeting_score": 50, "mom_draft": raw_response or ""}

    meeting.raw_notes = raw_notes
    meeting.meeting_score = result_data.get("meeting_score")
    meeting.what_went_right = result_data.get("what_went_right")
    meeting.what_went_wrong = result_data.get("what_went_wrong")
    meeting.next_steps = result_data.get("next_steps")
    meeting.mom_draft = result_data.get("mom_draft")
    meeting.status = "completed"
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)

    return {
        "meeting_id": str(meeting_id),
        **result_data,
    }
