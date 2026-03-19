"""
Signal routes — buying/intent signals per company.

Endpoints:
  GET  /signals/company/{company_id}        — list all signals for a company
  POST /signals/company/{company_id}/refresh — re-fetch signals from NewsAPI + scraping
  POST /signals/                            — manually create a signal
  DELETE /signals/{signal_id}              — delete a signal
"""
from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.signal import Signal, SignalCreate, SignalRead
from app.models.company import Company

router = APIRouter(prefix="/signals", tags=["signals"])


@router.get("/company/{company_id}", response_model=List[SignalRead])
async def get_company_signals(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Return all signals for a company, newest first."""
    result = await session.execute(
        select(Signal)
        .where(Signal.company_id == company_id)
        .order_by(Signal.created_at.desc())
    )
    return result.scalars().all()


@router.post("/company/{company_id}/refresh")
async def refresh_company_signals(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Re-fetch signals from Google News RSS for the company.
    Stores funding, PR, and news signals. Deduplicates by title.
    """
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    from app.clients.news import NewsClient
    news_client = NewsClient()
    news_data = await news_client.get_company_signals(company.name, company.domain)
    news_data = news_data or {}

    created = 0
    all_articles = (
        [(a, "funding") for a in news_data.get("funding_signals", [])]
        + [(a, "pr") for a in news_data.get("pr_signals", [])]
        + [(a, "news") for a in news_data.get("articles", [])]
    )

    for article, sig_type in all_articles:
        title = article.get("title") or ""
        if not title:
            continue

        # Deduplicate by title
        existing = await session.execute(
            select(Signal).where(
                Signal.company_id == company_id,
                Signal.title == title,
            )
        )
        if existing.scalar_one_or_none():
            continue

        signal = Signal(
            company_id=company_id,
            signal_type=sig_type,
            source="google_news",
            title=title,
            url=article.get("url"),
            summary=article.get("summary") or article.get("description"),
            published_at=article.get("published_at"),
        )
        session.add(signal)
        created += 1

    await session.commit()
    return {"company_id": str(company_id), "signals_created": created}


@router.post("/", response_model=SignalRead, status_code=201)
async def create_signal(
    payload: SignalCreate,
    session: AsyncSession = Depends(get_session),
):
    """Manually add a signal for a company."""
    signal = Signal(**payload.model_dump())
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


@router.delete("/{signal_id}", status_code=204)
async def delete_signal(
    signal_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    signal = await session.get(Signal, signal_id)
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    await session.delete(signal)
    await session.commit()
