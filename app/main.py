from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.core.exceptions import BeaconError, register_exception_handlers

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
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
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


# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "healthy", "service": "beacon-crm-api", "version": "2.0.0"}


@app.get("/", tags=["health"])
async def root():
    return {"message": "Beacon CRM API", "docs": "/docs", "version": "2.0.0"}
