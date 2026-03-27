from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.config import settings
from app.core.exceptions import BeaconError, register_exception_handlers

# FastAPI app bootstrap:
# 1. create the app
# 2. attach cross-origin policy for the browser frontend
# 3. register shared exception handling
# 4. mount the versioned API router
app = FastAPI(
    title="Beacon CRM API",
    description="GTM Sales CRM for Beacon.li — AI Implementation Orchestration",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# The frontend talks to the API directly from the browser, so allowed origins
# come from settings instead of being hard-coded in each route.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Centralise app-specific errors so route handlers can raise domain errors
# without duplicating HTTP status mapping logic everywhere.
register_exception_handlers(app)

# All API endpoints live under /api/v1. A future v2 can be mounted alongside it
# without changing the existing route modules.
app.include_router(v1_router, prefix="/api/v1")


# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "healthy", "service": "beacon-crm-api", "version": "2.0.0"}


@app.get("/", tags=["health"])
async def root():
    return {"message": "Beacon CRM API", "docs": "/docs", "version": "2.0.0"}
