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

    # Legacy background queue setting (no longer required for deployment)
    REDIS_URL: str = "redis://localhost:6379/0"

    # App
    SECRET_KEY: str = "dev_secret_key"
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = ",".join([
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ])

    # External API keys (empty string = mock mode)
    APOLLO_API_KEY: str = ""
    HUNTER_API_KEY: str = ""
    BUILTWITH_API_KEY: str = ""
    INSTANTLY_API_KEY: str = ""
    FIREFLIES_API_KEY: str = ""
    NEWS_API_KEY: str = ""  # No longer required — news client uses Google News RSS

    # Azure OpenAI
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = "gpt-4o-mini"
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"

    # Anthropic Claude (demo HTML generation)
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_API_KEY: str = ""  # alias — some .env files use this name
    ANTHROPIC_MODEL: str = "claude-opus-4-6"

    # Demo generation tuning
    DEMO_MODEL: str = "claude-sonnet-4-20250514"  # Sonnet 4 — best availability + quality for code gen
    DEMO_MAX_TOKENS: int = 30000             # Extended thinking unlocks 64K; 30K is plenty for 15-25K token demos
    DEMO_THINKING_BUDGET: int = 10000        # Tokens for planning HTML structure before writing
    DEMO_TIMEOUT_SECONDS: int = 300          # Per-attempt timeout (streaming)

    @property
    def claude_api_key(self) -> str:
        """Return whichever Claude key is set (ANTHROPIC_API_KEY or CLAUDE_API_KEY)."""
        return self.ANTHROPIC_API_KEY or self.CLAUDE_API_KEY

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    # Resend (email sending)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "onboarding@resend.dev"


settings = Settings()
