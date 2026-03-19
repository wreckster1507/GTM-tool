from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to this file so it works regardless of CWD
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://beacon:beacon_dev@localhost:5432/beacon_crm"
    SYNC_DATABASE_URL: str = "postgresql://beacon:beacon_dev@localhost:5432/beacon_crm"

    # Redis / Celery
    REDIS_URL: str = "redis://localhost:6379/0"

    # App
    SECRET_KEY: str = "dev_secret_key"
    ENVIRONMENT: str = "development"

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

    # Resend (email sending)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "onboarding@resend.dev"


settings = Settings()
