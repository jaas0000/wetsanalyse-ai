#!/usr/bin/env python3
"""Genereer de secrets/-map met willekeurige tokens en wachtwoorden.

Gebruik (vanuit deploy/compose/):
    python3 gen-secrets.py

Vult secrets/ met alle benodigde bestanden. Bestaande bestanden worden
NIET overschreven — verwijder secrets/ eerst voor een frisse start.
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
    path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)  # 644
    print(f"  aangemaakt: {path.name}")


def main() -> None:
    secrets_dir = Path(__file__).parent / "secrets"
    secrets_dir.mkdir(mode=0o755, exist_ok=True)

    fe_tok   = secrets.token_hex(24)   # frontend → API
    adm_tok  = secrets.token_hex(24)   # frontend → API (admin)
    db_pass  = secrets.token_hex(24)   # PostgreSQL
    mcp_tok  = secrets.token_hex(24)   # API → wettenbank-MCP
    fernet   = base64.urlsafe_b64encode(os.urandom(32)).decode()
    auth_sec = base64.b64encode(os.urandom(32)).decode()

    print(f"Secrets schrijven naar {secrets_dir}/")
    write_secret(secrets_dir / "api_tokens",           f"frontend:{fe_tok}")
    write_secret(secrets_dir / "admin_tokens",         f"admin:{adm_tok}")
    write_secret(secrets_dir / "frontend_api_token",   fe_tok)
    write_secret(secrets_dir / "frontend_admin_token", adm_tok)
    write_secret(secrets_dir / "frontend_auth_secret", auth_sec)
    write_secret(secrets_dir / "postgres_password",    db_pass)
    write_secret(secrets_dir / "wettenbank_token",     mcp_tok)
    write_secret(secrets_dir / "llm_config_secret",    fernet)

    # LLM API-key: haal op uit .env of vraag interactief
    llm_key_path = secrets_dir / "llm_api_key"
    if not llm_key_path.exists():
        env_key = _read_env_var("LLM_API_KEY")
        if env_key:
            write_secret(llm_key_path, env_key)
        else:
            key = input("  Azure AI Foundry API-key: ").strip()
            write_secret(llm_key_path, key)

    print("\nKlaar. Geef nog een wettenbank-token op als je die nog niet hebt:")
    print(f"  echo '<token>' > {secrets_dir}/wettenbank_token")
    print("\nStart daarna de stack met:")
    print("  podman-compose up -d")
    print("  docker compose up -d")


def _read_env_var(name: str) -> str:
    """Lees variabele uit .env of de omgeving."""
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
