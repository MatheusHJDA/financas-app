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
    openai_timeout_seconds: float = 60.0

    upload_dir: str = "/data/uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    backup_dir: str = "/data/backups"

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    initial_pin_matheus: str = ""
    initial_pin_ruth: str = ""

    tz: str = "America/Sao_Paulo"
    session_days: int = 30
    session_idle_minutes: int = 30
    session_max_hours: int = 12

    # Login em duas etapas (chave de acesso). Ligue só na VPS: RP_ID = domínio, ORIGIN = https://domínio.
    require_passkey: bool = False
    passkey_rp_id: str = ""
    passkey_origin: str = ""

    # Swagger/OpenAPI em /api/docs e /api/openapi.json: desligado, só para depurar.
    enable_docs: bool = False
    # Hosts aceitos no cabeçalho Host, separados por vírgula ("*.ts.net" vale para o tailnet).
    allowed_hosts: str = "localhost,127.0.0.1,*.ts.net"

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
