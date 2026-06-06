"""Gebruikersbeheer en authenticatie.

Simpel model: gebruikersnaam + wachtwoord (bcrypt).
API-keys worden versleuteld opgeslagen met Fernet.
Ondersteunt twee providers: Azure OpenAI en OpenRouter.
"""

import logging
import os
import sqlite3
from pathlib import Path
from typing import Optional

import bcrypt
from cryptography.fernet import Fernet
from itsdangerous import TimestampSigner, BadSignature, SignatureExpired
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings

logger = logging.getLogger(__name__)

DB_PATH = None  # Wordt lazy geïnitialiseerd vanuit settings
FERNET_KEY_PATH = None  # Wordt lazy geïnitialiseerd


def _db_path() -> Path:
    """Haal het database pad vanuit settings."""
    return Path(settings.database_path)


def _fernet_key_path() -> Path:
    """Haal het Fernet key pad (naast de database)."""
    return _db_path().parent / ".fernet_key"

security = HTTPBearer(auto_error=False)

# Token signer voor session tokens (HMAC-signed met secret_key)
def _get_signer() -> TimestampSigner:
    """Haal de signer voor session tokens."""
    return TimestampSigner(settings.secret_key)


def _get_fernet() -> Fernet:
    """Haal of genereer de Fernet-sleutel voor API-key encryptie."""
    fernet_path = _fernet_key_path()
    # Check ook environment variable voor container deployments
    env_key = os.environ.get("FERNET_KEY")
    if env_key:
        try:
            return Fernet(env_key.encode())
        except (ValueError, TypeError) as e:
            raise RuntimeError(
                f"FERNET_KEY is ongeldig: {e}. "
                "De FERNET_KEY omgevingsvariabele moet een geldige Fernet-sleutel zijn "
                "(base64-gecodeerde 32-byte string, te genereren met Fernet.generate_key())."
            ) from e
    if fernet_path.exists():
        key = fernet_path.read_bytes()
    else:
        key = Fernet.generate_key()
        fernet_path.parent.mkdir(parents=True, exist_ok=True)
        fernet_path.write_bytes(key)
        fernet_path.chmod(0o600)
    return Fernet(key)


def _encrypt(text: str) -> str:
    """Versleutel een string."""
    return _get_fernet().encrypt(text.encode()).decode()


def _decrypt(token: str) -> str:
    """Ontsleutel een string."""
    return _get_fernet().decrypt(token.encode()).decode()


def _get_db() -> sqlite3.Connection:
    """Haal een database-connectie."""
    db_path = _db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialiseer de database."""
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            provider TEXT DEFAULT 'azure',
            endpoint TEXT DEFAULT '',
            api_key_encrypted TEXT DEFAULT '',
            model TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            wet TEXT NOT NULL,
            bwb_id TEXT NOT NULL,
            artikel TEXT NOT NULL,
            versiedatum TEXT DEFAULT '',
            bronreferentie TEXT DEFAULT '',
            sectie TEXT DEFAULT '',
            pad TEXT DEFAULT '',
            activiteit_2_json TEXT DEFAULT '',
            activiteit_3_json TEXT DEFAULT '',
            review_feedback_2 TEXT DEFAULT '',
            review_feedback_3 TEXT DEFAULT '',
            rapport_md TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(username)
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
    """)

    # Migratie: als oude kolommen bestaan, voeg nieuwe toe
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "azure_endpoint" in cols and "provider" not in cols:
            logger.info("Migratie: oude users-tabel -> nieuwe provider-tabel")
            conn.executescript("""
                ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'azure';
                ALTER TABLE users ADD COLUMN endpoint TEXT DEFAULT '';
                ALTER TABLE users ADD COLUMN api_key_encrypted TEXT DEFAULT '';
                ALTER TABLE users ADD COLUMN model TEXT DEFAULT '';
            """)
            # Kopieer oude data
            conn.execute("""
                UPDATE users SET
                    endpoint = COALESCE(azure_endpoint, ''),
                    api_key_encrypted = COALESCE(azure_api_key_encrypted, ''),
                    model = COALESCE(azure_deployment, '')
            """)
            conn.commit()
    except Exception as e:
        logger.warning("Migratie overgeslagen: %s", e)

    conn.commit()
    conn.close()
    logger.info("Database geinitialiseerd: %s", _db_path())


class User:
    """Gebruikersmodel.

    provider: 'azure' of 'openrouter'
    endpoint: Azure endpoint URL of OpenRouter base URL
    api_key: ontsleutelde API key
    model: Azure deployment naam of OpenRouter model identifier
    """

    def __init__(
        self,
        username: str,
        provider: str = "azure",
        endpoint: str = "",
        api_key: str = "",
        model: str = "",
    ):
        self.username = username
        self.provider = provider
        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key)


def create_user(username: str, password: str) -> User:
    """Maak een nieuwe gebruiker aan."""
    conn = _get_db()
    try:
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash),
        )
        conn.commit()
        logger.info("Gebruiker aangemaakt: %s", username)
        return User(username=username)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Gebruikersnaam bestaat al")
    finally:
        conn.close()


def authenticate(username: str, password: str) -> Optional[User]:
    """Verifieer inloggegevens."""
    conn = _get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if row is None:
        return None

    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None

    return _row_to_user(row)


def _row_to_user(row: sqlite3.Row) -> User:
    """Converteer een database-row naar een User-object."""
    api_key = ""
    key_col = "api_key_encrypted" if "api_key_encrypted" in row.keys() else "azure_api_key_encrypted"
    if row[key_col]:
        try:
            api_key = _decrypt(row[key_col])
        except Exception:
            logger.warning("Kon API-key niet ontsleutelen voor %s", row["username"])

    provider = row["provider"] if "provider" in row.keys() else "azure"
    endpoint = row["endpoint"] if "endpoint" in row.keys() else row.get("azure_endpoint", "")
    model = row["model"] if "model" in row.keys() else row.get("azure_deployment", "")

    return User(
        username=row["username"],
        provider=provider,
        endpoint=endpoint,
        api_key=api_key,
        model=model,
    )


def update_api_key(
    username: str,
    provider: str,
    endpoint: str,
    api_key: str,
    model: str,
):
    """Sla de API-key van een gebruiker op (versleuteld)."""
    conn = _get_db()
    encrypted_key = _encrypt(api_key)
    conn.execute(
        """UPDATE users SET provider = ?, endpoint = ?, api_key_encrypted = ?,
           model = ? WHERE username = ?""",
        (provider, endpoint, encrypted_key, model, username),
    )
    conn.commit()
    conn.close()
    logger.info("API-key bijgewerkt voor: %s (provider=%s)", username, provider)


def get_user(username: str) -> Optional[User]:
    """Haal een gebruiker op."""
    conn = _get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if row is None:
        return None

    return _row_to_user(row)


def sign_session_token(username: str, random_hex: str) -> str:
    """Sign een session token met HMAC zodat het niet te vervalsen is."""
    payload = f"{username}:{random_hex}"
    return _get_signer().sign(payload).decode()


def verify_session_token(token: str) -> Optional[str]:
    """Verifieer een session token en retourneer de username, of None."""
    try:
        payload = _get_signer().unsign(token, max_age=86400 * 7)
        username = payload.decode().split(":")[0]
        return username
    except (BadSignature, SignatureExpired, IndexError):
        return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """Haal de huidige gebruiker op uit de sessie of bearer token."""
    token = request.cookies.get("session_token") or (
        credentials.credentials if credentials else None
    )

    if not token:
        raise HTTPException(401, "Niet ingelogd")

    username = verify_session_token(token)
    if username is None:
        raise HTTPException(401, "Ongeldige of verlopen sessie")

    user = get_user(username)
    if user is None:
        raise HTTPException(401, "Gebruiker niet gevonden")

    return user
