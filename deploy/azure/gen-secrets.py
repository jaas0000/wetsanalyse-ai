#!/usr/bin/env python3
"""Genereer de secrets/-map voor lokaal draaien via docker-compose.

Gebruik (vanuit deploy/azure/):
    python3 gen-secrets.py

Vult secrets/ met alle benodigde bestanden. Bestaande bestanden worden
NIET overschreven.
"""
import base64
import os
import secrets
import stat
from pathlib import Path


def write_secret(path: Path, value: str) -> None:
    if path.exists():
        print(f"  overgeslagen (bestaat al): {path.name}")
        return
    path.write_text(value, encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    print(f"  aangemaakt: {path.name}")


def main() -> None:
    secrets_dir = Path(__file__).parent / "secrets"
    secrets_dir.mkdir(mode=0o755, exist_ok=True)

    fe_tok  = secrets.token_hex(24)
    adm_tok = secrets.token_hex(24)
    db_pass = secrets.token_hex(24)
    fernet  = base64.urlsafe_b64encode(os.urandom(32)).decode()
    auth    = base64.b64encode(os.urandom(32)).decode()
    db_url  = f"postgresql+asyncpg://wetsanalyse:{db_pass}@postgres:5432/wetsanalyse"

    print(f"Secrets schrijven naar {secrets_dir}/")
    write_secret(secrets_dir / "postgres_password",    db_pass)
    write_secret(secrets_dir / "database_url",         db_url)
    write_secret(secrets_dir / "api_tokens",           f"frontend:{fe_tok}")
    write_secret(secrets_dir / "admin_tokens",         f"admin:{adm_tok}")
    write_secret(secrets_dir / "frontend_api_token",   fe_tok)
    write_secret(secrets_dir / "frontend_admin_token", adm_tok)
    write_secret(secrets_dir / "frontend_auth_secret", auth)
    write_secret(secrets_dir / "llm_config_secret",    fernet)

    llm_key_path = secrets_dir / "llm_api_key"
    if not llm_key_path.exists():
        key = _read_env_var("LLM_API_KEY")
        if not key:
            key = input("  Azure AI Foundry API-key: ").strip()
        write_secret(llm_key_path, key)

    print("\nKlaar. Start de stack met:")
    print("  docker compose up -d")
    print("  podman-compose up -d")


def _read_env_var(name: str) -> str:
    val = os.environ.get(name, "")
    if val:
        return val
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return ""


if __name__ == "__main__":
    main()
