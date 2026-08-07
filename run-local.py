#!/usr/bin/env python3
"""
Draai de wetsanalyse-stack lokaal (development-modus).

Wat dit doet:
  1. Genereert bij de eerste run zelf de interne secrets (Postgres-wachtwoord, interne
     API/admin-tokens, twee dev-inlogaccounts) in local-setup/secrets-local/ (gitignored,
     buiten git) — stabiel over herhaalde runs, want persistent opgeslagen.
  2. Start een PostgreSQL-container via podman (poort 5432).
  3. Schrijft .env (API) en frontend/.env.local (frontend) — worden NIET gecommit.
  4. Start de API op poort 3010  (uvicorn, hot-reload).
  5. Start de frontend op poort 3011 (Next.js dev server).

Stop alles met Ctrl+C.

Vóór de EERSTE run moet je drie échte externe credentials zelf aanleveren — dit script kan
ze niet zelf genereren, want het zijn geen lokale secrets maar bestaande, externe waarden:

    mkdir -p local-setup/secrets-local
    echo -n "<azure-ai-foundry-key>"                        > local-setup/secrets-local/llm_api_key
    echo -n "https://<resource-naam>.services.ai.azure.com" > local-setup/secrets-local/llm_api_base
    echo -n "<wettenbank-token>"                             > local-setup/secrets-local/wettenbank_token

Alle andere secrets (Postgres, interne tokens, dev-inlogwachtwoorden) genereert het script zelf
bij de eerste run en onthoudt ze in dezelfde map.

SSH-forwarding vanuit je Mac (zie ook de skill 'local-dev-run'):
  ssh -L 3011:localhost:3011 wet-admin@<ip>
  → open http://localhost:3011 in je browser
"""

from __future__ import annotations

import base64
import os
import pathlib
import secrets as secrets_lib


def schrijf_prive(path: pathlib.Path, inhoud: str) -> None:
    """Schrijf een bestand met mode 0o600 in één atomaire syscall (geen readable window)."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(inhoud)


import signal
import subprocess
import sys
import time

# ---------------------------------------------------------------------------
# Paden
# ---------------------------------------------------------------------------
SCRIPT_DIR   = pathlib.Path(__file__).parent.resolve()
SECRETS_DIR  = SCRIPT_DIR / "local-setup" / "secrets-local"
API_DIR      = SCRIPT_DIR / "api"
FRONTEND_DIR = SCRIPT_DIR / "frontend"

API_PORT      = 3010
FRONTEND_PORT = 3011
PG_HOST_PORT  = 5432
PG_CONTAINER  = "wetsanalyse-dev-postgres"

# ---------------------------------------------------------------------------
# Hulpfuncties
# ---------------------------------------------------------------------------
def secret(name: str) -> str:
    """Externe credential — moet al bestaan; dit script genereert 'm niet (kan niet: het is een
    echte waarde van buiten deze machine, zoals een Azure-key of een gedeeld bearer-token)."""
    p = SECRETS_DIR / name
    if not p.exists():
        sys.exit(
            f"[FOUT] Externe secret ontbreekt: {p}\n"
            f"       Zie de module-docstring bovenaan dit script voor welke drie bestanden je\n"
            f"       zelf moet aanmaken, bv.: mkdir -p {SECRETS_DIR} && echo -n '<waarde>' > {p}"
        )
    return p.read_text().strip()


def secret_of_gegenereerd(name: str, genereer) -> str:
    """Interne secret — alleen relevant voor de lokale stack zelf (geen echte externe
    credential). Wordt bij ontbreken eenmalig gegenereerd en persistent opgeslagen, zodat 'ie
    stabiel blijft over herhaalde runs (belangrijk voor de idempotente accountaanmaak
    hieronder: een bestaand dev-account moet bij de volgende run hetzelfde wachtwoord houden)."""
    p = SECRETS_DIR / name
    if not p.exists():
        SECRETS_DIR.mkdir(parents=True, exist_ok=True)
        schrijf_prive(p, genereer())
    return p.read_text().strip()


def genereer_token() -> str:
    return secrets_lib.token_urlsafe(24)


def genereer_wachtwoord() -> str:
    # Kort genoeg om handmatig over te typen tijdens lokaal testen, met ruim voldoende entropie
    # voor een throwaway lokaal dev-account dat nooit buiten deze machine komt.
    return secrets_lib.token_urlsafe(9)


def genereer_fernet_key() -> str:
    # Zelfde formaat als cryptography.fernet.Fernet.generate_key(): 32 willekeurige bytes,
    # urlsafe-base64. Geen cryptography-import nodig in dit orchestratie-script (draait met de
    # ambient python3, niet per se met de venv waarin die dependency zit) — de API zelf leest
    # deze waarde later gewoon in via Fernet(...), wat elke geldige key van dit formaat accepteert.
    return base64.urlsafe_b64encode(secrets_lib.token_bytes(32)).decode()


def log(msg: str) -> None:
    print(f"\033[1;36m==>\033[0m {msg}", flush=True)


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kwargs)


# ---------------------------------------------------------------------------
# 1. Secrets inlezen (intern: genereren-en-onthouden; extern: moet al bestaan)
# ---------------------------------------------------------------------------
log("Secrets inlezen (interne secrets worden zo nodig eenmalig gegenereerd)…")
pg_user    = secret_of_gegenereerd("postgres_user", lambda: "wetsanalyse")
pg_pass    = secret_of_gegenereerd("postgres_password", genereer_token)
api_token  = secret_of_gegenereerd("frontend_api_token", genereer_token)
adm_token  = secret_of_gegenereerd("frontend_admin_token", genereer_token)
auth_sec   = secret_of_gegenereerd("frontend_auth_secret", genereer_token)
cfg_secret = secret_of_gegenereerd("llm_config_secret", genereer_fernet_key)
adm_tokens = secret_of_gegenereerd("admin_tokens", lambda: f"admin:{genereer_token()}")
api_tokens = secret_of_gegenereerd("api_tokens", lambda: f"frontend:{genereer_token()}")
admin_pw   = secret_of_gegenereerd("local_admin_password", genereer_wachtwoord)
test_pw    = secret_of_gegenereerd("local_test_password", genereer_wachtwoord)

llm_key  = secret("llm_api_key")
llm_base = secret("llm_api_base")
mcp_tok  = secret("wettenbank_token")

DATABASE_URL = (
    f"postgresql+asyncpg://{pg_user}:{pg_pass}@localhost:{PG_HOST_PORT}/wetsanalyse"
)

# ---------------------------------------------------------------------------
# 2. PostgreSQL starten via podman
# ---------------------------------------------------------------------------
log(f"PostgreSQL starten (podman, poort {PG_HOST_PORT})…")
existing = subprocess.run(
    ["podman", "ps", "-q", "--filter", f"name={PG_CONTAINER}"],
    capture_output=True, text=True,
).stdout.strip()

if existing:
    log("  PostgreSQL-container al actief — overgeslagen.")
else:
    stopped = subprocess.run(
        ["podman", "ps", "-aq", "--filter", f"name={PG_CONTAINER}"],
        capture_output=True, text=True,
    ).stdout.strip()
    if stopped:
        run(["podman", "start", PG_CONTAINER])
    else:
        run([
            "podman", "run", "-d",
            "--name", PG_CONTAINER,
            "-e", f"POSTGRES_USER={pg_user}",
            "-e", f"POSTGRES_PASSWORD={pg_pass}",
            "-e", "POSTGRES_DB=wetsanalyse",
            "-p", f"127.0.0.1:{PG_HOST_PORT}:5432",
            "postgres:16",
        ])
    log("  Wachten tot postgres gereed is…")
    for _ in range(30):
        r = subprocess.run(
            ["podman", "exec", PG_CONTAINER,
             "pg_isready", "-U", pg_user, "-d", "wetsanalyse"],
            capture_output=True,
        )
        if r.returncode == 0:
            break
        time.sleep(1)
    else:
        sys.exit("[FOUT] PostgreSQL niet bereikbaar na 30 seconden.")

# ---------------------------------------------------------------------------
# 3. .env voor de API schrijven
# ---------------------------------------------------------------------------
log("API .env schrijven…")
env_path = API_DIR / ".env"
schrijf_prive(env_path, f"""\
DATABASE_URL={DATABASE_URL}
WETSANALYSE_API_TOKENS={api_tokens}
WETSANALYSE_ADMIN_TOKENS={adm_tokens}
WETSANALYSE_AUTH_REQUIRED=1
WETTENBANK_MCP_URL=https://wettenbank-mcp.ipalm.nl/mcp
WETTENBANK_TOKEN={mcp_tok}
LLM_PROVIDER=azure_ai
LLM_MODEL=claude-sonnet-4-6
LLM_API_BASE={llm_base}
LLM_API_KEY={llm_key}
LLM_CONFIG_SECRET={cfg_secret}
LOG_FORMAT=text
""")

# ---------------------------------------------------------------------------
# 4. .env.local voor de frontend schrijven
# ---------------------------------------------------------------------------
log("Frontend .env.local schrijven…")
env_local = FRONTEND_DIR / ".env.local"
schrijf_prive(env_local, f"""\
API_BASE_URL=http://localhost:{API_PORT}
API_TOKEN={api_token}
ADMIN_API_TOKEN={adm_token}
AUTH_SECRET={auth_sec}
AUTH_URL=http://localhost:{FRONTEND_PORT}
NODE_ENV=development
""")

# ---------------------------------------------------------------------------
# 5. Processen starten
# ---------------------------------------------------------------------------
log(f"API starten op poort {API_PORT}…")
api_env = {**os.environ, "PATH": os.environ["PATH"]}
api_proc = subprocess.Popen(
    ["uv", "run", "--env-file", ".env", "--extra", "llm",
     "uvicorn", "app.main:app", "--reload", "--port", str(API_PORT)],
    cwd=API_DIR,
    env=api_env,
)

log("  Wachten tot API gereed is…")
import urllib.request, urllib.error
for _ in range(40):
    try:
        urllib.request.urlopen(f"http://localhost:{API_PORT}/health", timeout=2)
        break
    except Exception:
        time.sleep(1)
else:
    api_proc.terminate()
    sys.exit("[FOUT] API niet bereikbaar na 40 seconden.")

# ---------------------------------------------------------------------------
# 5b. Standaard testgebruikers aanmaken (idempotent — 409 = al bestaat)
# ---------------------------------------------------------------------------
import json, http.client

def api_post(path: str, body: dict, headers: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    conn = http.client.HTTPConnection("localhost", API_PORT)
    conn.request("POST", path, data, {"Content-Type": "application/json", **headers})
    r = conn.getresponse()
    return r.status, json.loads(r.read() or b"{}")

adm_bearer = adm_tokens.split(":", 1)[1]
fe_bearer  = api_tokens.split(":", 1)[1]

log("Testgebruikers aanmaken…")

# 1. admin — beheerder (via setup; 409 als al bestaat). Wachtwoord komt uit
#    local-setup/secrets-local/local_admin_password (gegenereerd bij de eerste run).
status, body = api_post(
    "/v1/auth/setup",
    {"userid": "admin", "email": "admin@local.test", "password": admin_pw},
    {"Authorization": f"Bearer {fe_bearer}"},
)
if status == 201:
    log("  admin (beheerder) aangemaakt")
elif status == 409:
    log("  admin bestaat al — overgeslagen")
else:
    log(f"  admin: onverwacht {status} — {body}")

# 2. test — analist (via admin; 409 als al bestaat). Wachtwoord komt uit
#    local-setup/secrets-local/local_test_password.
status, body = api_post(
    "/v1/admin/users",
    {"userid": "test", "email": "test@local.test", "password": test_pw, "role": "analist"},
    {"Authorization": f"Bearer {adm_bearer}"},
)
if status == 201:
    temp_pw = body.get("temp_password", "")
    # Zet tijdelijk wachtwoord direct om naar het gegenereerde permanente wachtwoord.
    api_post(
        "/v1/auth/change-password",
        {"current": temp_pw, "new": test_pw},
        {"Authorization": f"Bearer {fe_bearer}", "X-User-Id": "test"},
    )
    log("  test (analist) aangemaakt")
elif status == 409:
    log("  test bestaat al — overgeslagen")
else:
    log(f"  test: onverwacht {status} — {body}")

log(f"Frontend starten op poort {FRONTEND_PORT}…")
fe_proc = subprocess.Popen(
    ["npm", "run", "dev", "--", "-p", str(FRONTEND_PORT)],
    cwd=FRONTEND_DIR,
)

print()
print("\033[1;32m✓ Stack actief\033[0m")
print(f"  Frontend : \033[4mhttp://localhost:{FRONTEND_PORT}\033[0m")
print(f"  API docs : \033[4mhttp://localhost:{API_PORT}/docs\033[0m")
print()
print("\033[1mTestgebruikers\033[0m (wachtwoorden persistent opgeslagen in local-setup/secrets-local/):")
print(f"  admin / {admin_pw}  (beheerder)")
print(f"  test  / {test_pw}  (analist)")
print()
print("\033[1mSSH-forwarding vanuit Mac:\033[0m")
print(f"  ssh -L {FRONTEND_PORT}:localhost:{FRONTEND_PORT} wet-admin@<ip-van-deze-vm>")
print(f"  → open http://localhost:{FRONTEND_PORT}")
print()
print("\033[1mTunnel sluiten:\033[0m")
print("  Sluit het SSH-venster (exit / Ctrl+D),")
print("  of druk in de SSH-sessie: ~ gevolgd door . (tilde-punt)")
print()
print("  Druk Ctrl+C om de stack te stoppen.")

# ---------------------------------------------------------------------------
# 6. Wachten en netjes stoppen
# ---------------------------------------------------------------------------
def cleanup(signum, frame):
    log("Stoppen…")
    fe_proc.terminate()
    api_proc.terminate()
    fe_proc.wait()
    api_proc.wait()
    log("Klaar.")
    sys.exit(0)

signal.signal(signal.SIGINT,  cleanup)
signal.signal(signal.SIGTERM, cleanup)

try:
    while True:
        time.sleep(1)
        if api_proc.poll() is not None:
            fe_proc.terminate()
            sys.exit("[FOUT] API-proces onverwacht gestopt.")
        if fe_proc.poll() is not None:
            api_proc.terminate()
            sys.exit("[FOUT] Frontend-proces onverwacht gestopt.")
except KeyboardInterrupt:
    cleanup(None, None)
