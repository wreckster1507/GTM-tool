from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.config import settings
from app.core.exceptions import BeaconError, register_exception_handlers
from app.services.background_jobs import shutdown_background_workers, start_background_workers

app = FastAPI(
    title="Beacon CRM API",
    description="GTM Sales CRM for Beacon.li — AI Implementation Orchestration",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Exception handlers ───────────────────────────────────────────────────────
# Custom BeaconError subclasses map cleanly to HTTP status codes.
# No more HTTPException(status_code=404, ...) scattered across every route.
register_exception_handlers(app)

# ── API v1 router ────────────────────────────────────────────────────────────
# All routes live under /api/v1/.  Adding v2 later = mount a second router.
app.include_router(v1_router, prefix="/api/v1")


@app.on_event("startup")
async def startup_background_workers() -> None:
    await start_background_workers()


@app.on_event("shutdown")
async def stop_background_workers() -> None:
    await shutdown_background_workers()


# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "healthy", "service": "beacon-crm-api", "version": "2.0.0"}


@app.get("/", tags=["health"])
async def root():
    return {"message": "Beacon CRM API", "docs": "/docs", "version": "2.0.0"}
