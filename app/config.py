from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to this file so it works regardless of CWD
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://beacon:beacon_dev@localhost:5432/beacon_crm"
    SYNC_DATABASE_URL: str = "postgresql://beacon:beacon_dev@localhost:5432/beacon_crm"

    # Legacy background queue setting (not required by the active deployment path)
    REDIS_URL: str = "redis://localhost:6379/0"

    # App
    SECRET_KEY: str = "dev_secret_key"
    ENVIRONMENT: str = "development"

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"
    FRONTEND_URL: str = "http://localhost:5173"
    GMAIL_CLIENT_ID: str = ""
    GMAIL_CLIENT_SECRET: str = ""
    GMAIL_OAUTH_REDIRECT_URI: str = "http://localhost:8000/api/v1/settings/email-sync/google/callback"

    # JWT
    JWT_SECRET: str = "jwt_dev_secret_change_me"
    JWT_EXPIRE_MINUTES: int = 1440  # 24 hours
    CORS_ORIGINS: str = ",".join([
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:8080",
    ])

    # External API keys (empty string = mock mode)
    APOLLO_API_KEY: str = ""
    HUNTER_API_KEY: str = ""
    SERPER_API_KEY: str = ""
    BUILTWITH_API_KEY: str = ""
    INSTANTLY_API_KEY: str = ""
    INSTANTLY_WEBHOOK_URL: str = ""  # e.g. https://yourdomain.com/api/v1/webhooks/instantly
    FIREFLIES_API_KEY: str = ""
    NEWS_API_KEY: str = ""  # No longer required — news client uses Google News RSS

    # Anthropic Claude
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_API_KEY: str = ""  # alias — some .env files use this name
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # CRM AI routing by complexity
    CLAUDE_MODEL_SIMPLE: str = "claude-haiku-4-5-20251001"
    CLAUDE_MODEL_STANDARD: str = "claude-sonnet-4-20250514"
    CLAUDE_MODEL_COMPLEX: str = "claude-opus-4-6"

    # Demo generation tuning
    DEMO_MODEL: str = "claude-sonnet-4-20250514"  # Sonnet 4 — best availability + quality for code gen
    DEMO_MAX_TOKENS: int = 30000             # Extended thinking unlocks 64K; 30K is plenty for 15-25K token demos
    DEMO_THINKING_BUDGET: int = 10000        # Tokens for planning HTML structure before writing
    DEMO_TIMEOUT_SECONDS: int = 300          # Per-attempt timeout (streaming)

    @property
    def claude_api_key(self) -> str:
        """Return whichever Claude key is set (ANTHROPIC_API_KEY or CLAUDE_API_KEY)."""
        # Some environments use the old variable name and others use the newer one,
        # so callers can depend on a single property instead of branching.
        return self.ANTHROPIC_API_KEY or self.CLAUDE_API_KEY

    @property
    def gmail_client_id(self) -> str:
        return self.GMAIL_CLIENT_ID or self.GOOGLE_CLIENT_ID

    @property
    def gmail_client_secret(self) -> str:
        return self.GMAIL_CLIENT_SECRET or self.GOOGLE_CLIENT_SECRET

    @property
    def cors_origins(self) -> List[str]:
        # `.env` stores this as a comma-separated string, but FastAPI middleware
        # expects an actual list of origins.
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    # Resend (email sending)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "onboarding@resend.dev"

    # Gmail shared inbox (email-to-activity sync)
    GMAIL_SHARED_INBOX: str = ""  # e.g. sales@beacon.li
    GMAIL_CREDENTIALS_JSON: str = ""  # Path to OAuth credentials.json
    GMAIL_TOKEN_JSON: str = ""  # Path to stored token.json (auto-refreshed)
    EMAIL_SYNC_INTERVAL_SECONDS: int = 180  # 3 minutes
    EMAIL_SUMMARY_MIN_CHARS: int = 100  # Skip AI summary for short emails

    # Aircall
    AIRCALL_API_ID: str = ""
    AIRCALL_API_TOKEN: str = ""
    AIRCALL_WEBHOOK_URL: str = ""
    AIRCALL_DEFAULT_NUMBER: str = ""  # E.164 digits of the default outbound number

    # tl;dv meeting intelligence
    TLDV_API_BASE: str = "https://pasta.tldv.io/v1alpha1"
    TLDV_API_KEY: str = ""
    TLDV_SYNC_LOOKBACK_DAYS: int = 365

    # ClickUp migration
    CLICKUP_API_BASE: str = "https://api.clickup.com/api/v2"
    CLICKUP_API_TOKEN: str = ""
    CLICKUP_TEAM_ID: str = ""
    CLICKUP_SPACE_ID: str = ""
    CLICKUP_DEALS_LIST_ID: str = ""


settings = Settings()
