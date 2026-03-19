"""
Battlecard routes — live-meeting knowledge base.

Endpoints:
  GET    /battlecards/                      — list all active battlecards
  POST   /battlecards/                      — create a battlecard
  GET    /battlecards/{id}                  — get one battlecard
  PUT    /battlecards/{id}                  — update
  DELETE /battlecards/{id}                  — delete

  GET    /battlecards/search?q=...          — search by trigger / title / tags
  POST   /battlecards/seed                  — seed with default Beacon.li cards
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.battlecard import Battlecard, BattlecardCreate, BattlecardRead, BattlecardUpdate

router = APIRouter(prefix="/battlecards", tags=["battlecards"])


@router.get("/search", response_model=List[BattlecardRead])
async def search_battlecards(
    q: str = Query(..., min_length=2),
    session: AsyncSession = Depends(get_session),
):
    """Full-text search across trigger, title, tags, response."""
    term = f"%{q.lower()}%"
    from sqlalchemy import func, or_
    result = await session.execute(
        select(Battlecard).where(
            Battlecard.is_active == True,
            or_(
                func.lower(Battlecard.trigger).like(term),
                func.lower(Battlecard.title).like(term),
                func.lower(Battlecard.tags).like(term),
            )
        ).limit(20)
    )
    return result.scalars().all()


@router.get("/", response_model=List[BattlecardRead])
async def list_battlecards(
    category: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    query = select(Battlecard).where(Battlecard.is_active == True)
    if category:
        query = query.where(Battlecard.category == category)
    result = await session.execute(query.order_by(Battlecard.category, Battlecard.title))
    return result.scalars().all()


@router.post("/", response_model=BattlecardRead, status_code=201)
async def create_battlecard(
    payload: BattlecardCreate,
    session: AsyncSession = Depends(get_session),
):
    card = Battlecard(**payload.model_dump())
    session.add(card)
    await session.commit()
    await session.refresh(card)
    return card


@router.get("/{battlecard_id}", response_model=BattlecardRead)
async def get_battlecard(
    battlecard_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    card = await session.get(Battlecard, battlecard_id)
    if not card:
        raise HTTPException(status_code=404, detail="Battlecard not found")
    return card


@router.put("/{battlecard_id}", response_model=BattlecardRead)
async def update_battlecard(
    battlecard_id: UUID,
    payload: BattlecardUpdate,
    session: AsyncSession = Depends(get_session),
):
    card = await session.get(Battlecard, battlecard_id)
    if not card:
        raise HTTPException(status_code=404, detail="Battlecard not found")
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(card, key, value)
    card.updated_at = datetime.utcnow()
    session.add(card)
    await session.commit()
    await session.refresh(card)
    return card


@router.delete("/{battlecard_id}", status_code=204)
async def delete_battlecard(
    battlecard_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    card = await session.get(Battlecard, battlecard_id)
    if not card:
        raise HTTPException(status_code=404, detail="Battlecard not found")
    await session.delete(card)
    await session.commit()


@router.post("/seed", status_code=201)
async def seed_battlecards(session: AsyncSession = Depends(get_session)):
    """
    Seed the knowledge base with default Beacon.li battlecards.
    Safe to run multiple times — skips cards that already exist by title.
    """
    defaults = [
        {
            "category": "objection",
            "title": "Price too high",
            "trigger": "too expensive, pricing, cost, budget",
            "response": (
                "Understood — let's look at the ROI together. Our customers typically see "
                "a 60–80% reduction in implementation time, which translates to 3–6 months "
                "saved per enterprise deployment. What's your current cost for a manual rollout?"
            ),
            "tags": "pricing,roi,objection",
        },
        {
            "category": "objection",
            "title": "We already have an implementation partner",
            "trigger": "partner, si, integrator, consultancy, accenture, deloitte",
            "response": (
                "We work alongside SIs, not against them. Beacon.li handles the orchestration layer — "
                "automating the repetitive handoffs, status updates, and config tasks — so your SI "
                "focuses on high-value customisation. Many of our customers use both."
            ),
            "tags": "partner,si,objection",
        },
        {
            "category": "objection",
            "title": "Security / data concerns",
            "trigger": "security, data, privacy, gdpr, soc2, compliance",
            "response": (
                "Beacon.li is SOC 2 Type II certified. We process orchestration metadata only — "
                "no customer PII leaves your environment. Our architecture uses agent-side execution "
                "with encrypted config tokens. Happy to share our security whitepaper."
            ),
            "tags": "security,compliance,gdpr",
        },
        {
            "category": "competitor",
            "title": "vs. Rocketlane",
            "trigger": "rocketlane",
            "response": (
                "Rocketlane is a project portal — great for customer-facing project tracking. "
                "Beacon.li is an AI orchestration engine that automates the *execution* of "
                "implementation tasks, not just the visibility. We complement Rocketlane."
            ),
            "competitor": "Rocketlane",
            "tags": "competitor,rocketlane",
        },
        {
            "category": "competitor",
            "title": "vs. Arrows",
            "trigger": "arrows",
            "response": (
                "Arrows focuses on customer onboarding checklists. Beacon.li goes deeper — "
                "we automate configuration, integration setup, and cross-system handoffs "
                "that Arrows can't touch. Different layers of the implementation stack."
            ),
            "competitor": "Arrows",
            "tags": "competitor,arrows",
        },
        {
            "category": "tech_faq",
            "title": "What integrations do you support?",
            "trigger": "integrations, api, connect, webhook, salesforce, hubspot",
            "response": (
                "We support 80+ native connectors including Salesforce, HubSpot, NetSuite, SAP, "
                "Workday, and Jira. Custom integrations are built using our REST/webhook framework. "
                "Average integration time is 2 days vs. 3–4 weeks for manual builds."
            ),
            "tags": "integrations,api,tech",
        },
        {
            "category": "tech_faq",
            "title": "How long does implementation take?",
            "trigger": "how long, timeline, time to value, ttv, onboarding time",
            "response": (
                "Typical time-to-value is 4–6 weeks for standard deployments vs. 4–6 months "
                "without Beacon.li. The AI orchestration layer handles environment setup, "
                "data migration templates, and regression testing in parallel."
            ),
            "tags": "timeline,ttv,implementation",
        },
        {
            "category": "use_case",
            "title": "HRTech SaaS deployment",
            "trigger": "hr, hris, payroll, workday, bamboo, people management",
            "response": (
                "In HRTech, Beacon.li automates the data migration from legacy HRIS, "
                "sets up SSO, configures payroll rules, and runs validation checks — "
                "cutting 8-week manual implementations to under 2 weeks."
            ),
            "tags": "hrtech,use_case,workday",
        },
    ]

    created = 0
    for card_data in defaults:
        existing = await session.execute(
            select(Battlecard).where(Battlecard.title == card_data["title"])
        )
        if existing.scalar_one_or_none():
            continue
        card = Battlecard(**card_data)
        session.add(card)
        created += 1

    await session.commit()
    return {"seeded": created, "message": f"{created} battlecards created"}
