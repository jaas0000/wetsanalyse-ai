#!/usr/bin/env python3
"""Genereer de vier OpenShift-secrets voor de 'simpel'-overlay (kale Postgres).

Print kant-en-klare Secret-YAML naar stdout met willekeurige, onderling consistente
tokens (frontend↔API, admin, API↔MCP), een Fernet-master-key, een Auth.js-secret en
een DB-wachtwoord. Geen externe dependencies nodig.

Gebruik:
    python3 deploy/openshift/gen-secrets.py > secrets.yaml          # Azure-key nog invullen
    python3 deploy/openshift/gen-secrets.py "<azure-key>" > secrets.yaml   # meteen compleet

Daarna: `oc apply -f secrets.yaml` (of plak de inhoud via de console → Import YAML).
Verwijder secrets.yaml na toepassen.
"""
import base64
import os
import secrets
import sys

azure_key = sys.argv[1] if len(sys.argv) > 1 else "<PLAK-HIER-JE-AZURE-AI-FOUNDRY-KEY>"

tok_frontend = secrets.token_hex(24)   # frontend → API
tok_admin = secrets.token_hex(24)      # frontend → API (admin)
tok_mcp = secrets.token_hex(24)        # API → MCP
db_pass = secrets.token_hex(24)        # PostgreSQL-wachtwoord
fernet = base64.urlsafe_b64encode(os.urandom(32)).decode()   # key-versleuteling at-rest
auth = base64.b64encode(os.urandom(32)).decode()             # Auth.js sessie-secret

print(f"""apiVersion: v1
kind: Secret
metadata:
  name: wetsanalyse-api-secrets
stringData:
  api_tokens: "frontend:{tok_frontend}"
  admin_tokens: "admin:{tok_admin}"
  wettenbank_token: "{tok_mcp}"
  llm_api_key: "{azure_key}"
  llm_config_secret: "{fernet}"
---
apiVersion: v1
kind: Secret
metadata:
  name: wetsanalyse-frontend-secrets
stringData:
  frontend_api_token: "{tok_frontend}"
  frontend_admin_token: "{tok_admin}"
  frontend_auth_secret: "{auth}"
---
apiVersion: v1
kind: Secret
metadata:
  name: wettenbank-mcp-secrets
stringData:
  mcp_auth_tokens: "api:{tok_mcp}"
---
apiVersion: v1
kind: Secret
metadata:
  name: wetsanalyse-db-app
stringData:
  password: "{db_pass}"
  uri: "postgresql://wetsanalyse:{db_pass}@wetsanalyse-db-rw:5432/wetsanalyse"
""")
