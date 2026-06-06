"""Configuratie voor de wetsanalyse webapp."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Applicatie-instellingen, te overschrijven via .env of omgevingsvariabelen."""

    # Server
    host: str = "0.0.0.0"
    port: int = 8080

    # Beveiliging
    secret_key: str = "verander-dit-in-productie"

    # Database
    database_path: str = "data/wetsanalyse.db"

    # SRU / BWB
    sru_base_url: str = "https://zoekservice.overheid.nl/sru/Search"
    bwb_repo_base: str = "https://repository.officiele-overheidspublicaties.nl/bwb"
    http_timeout: int = 15

    # Cache
    cache_ttl_seconds: int = 3600  # 1 uur

    model_config = {"env_file": ".env", "env_prefix": "WETSANALYSE_"}


settings = Settings()


def _validate_config():
    """Weiger te starten met de default secret_key."""
    if settings.secret_key == "verander-dit-in-productie":
        raise RuntimeError(
            "Onveilige configuratie: secret_key is nog de standaardwaarde. "
            "Stel WETSANALYSE_SECRET_KEY in via een omgevingsvariabele of .env-bestand."
        )
