"""
Custom exception hierarchy for Beacon CRM.

Usage in routes:
    raise NotFoundError("Company not found")
    raise ConflictError("Domain already exists")

FastAPI exception handlers are registered in main.py via register_exception_handlers().
"""
from fastapi import Request
from fastapi.responses import JSONResponse


class BeaconError(Exception):
    """Base for all Beacon CRM application errors."""
    status_code: int = 500

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFoundError(BeaconError):
    status_code = 404


class ConflictError(BeaconError):
    status_code = 409


class ValidationError(BeaconError):
    status_code = 422


class ExternalServiceError(BeaconError):
    """Raised when a third-party API call fails (Apollo, Hunter, Azure, etc.)."""
    status_code = 502


# ── FastAPI exception handlers ──────────────────────────────────────────────

async def beacon_exception_handler(request: Request, exc: BeaconError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "type": type(exc).__name__},
    )


def register_exception_handlers(app) -> None:
    """Register all custom exception handlers on the FastAPI app instance."""
    app.add_exception_handler(BeaconError, beacon_exception_handler)
    app.add_exception_handler(NotFoundError, beacon_exception_handler)
    app.add_exception_handler(ConflictError, beacon_exception_handler)
    app.add_exception_handler(ValidationError, beacon_exception_handler)
    app.add_exception_handler(ExternalServiceError, beacon_exception_handler)
