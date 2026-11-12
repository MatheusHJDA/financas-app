from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração lida do ambiente / `.env` (veja `.env.example`)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://financas:financas@db:5432/financas"
    postgres_user: str = "financas"
    postgres_password: str = ""
    postgres_db: str = "financas"

    openai_api_key: str = ""
    openai_model: str = ""

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    initial_pin_matheus: str = ""
    initial_pin_ruth: str = ""

    tz: str = "America/Sao_Paulo"
    session_days: int = 30


@lru_cache
def get_settings() -> Settings:
    return Settings()
