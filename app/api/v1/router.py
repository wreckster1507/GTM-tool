"""
Aggregates all v1 endpoint routers into a single router.

main.py includes this with prefix="/api/v1", so all routes are versioned
automatically. Adding v2 later means creating app/api/v2/router.py and
mounting it without touching any v1 files.
"""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    activities,
    battlecards,
    companies,
    contacts,
    deals,
    enrichment,
    intelligence,
    meetings,
    outreach,
    prospecting,
    signals,
    webhooks,
)

router = APIRouter()

router.include_router(companies.router)
router.include_router(contacts.router)
router.include_router(deals.router)
router.include_router(activities.router)
router.include_router(enrichment.router)
router.include_router(prospecting.router)
router.include_router(outreach.router)
router.include_router(intelligence.router)
router.include_router(signals.router)
router.include_router(meetings.router)
router.include_router(battlecards.router)
router.include_router(webhooks.router)
