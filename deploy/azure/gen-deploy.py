#!/usr/bin/env python3
"""Genereer een Bicep-parameterbestand en rol de Wetsanalyse-stack uit op Azure.

Gebruik:
    python3 deploy/azure/gen-deploy.py "<azure-ai-key>" \\
        --llm-api-base https://<resource>.services.ai.azure.com \\
        [--resource-group rg-wetsanalyse] \\
        [--location westeurope] \\
        [--run]

Vereisten:
    - az (Azure CLI) geïnstalleerd en ingelogd: az login
    - Resource group bestaat: az group create -n rg-wetsanalyse -l westeurope
"""
import argparse
import base64
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

TEMPLATE = Path(__file__).parent / "main.bicep"
DEFAULT_PARAMS = Path(__file__).parent / "params.json"


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("azure_ai_key",    help="Azure AI Foundry API-key")
    p.add_argument("--llm-api-base",  required=True,
                   help="Azure AI Foundry base-URL (bijv. https://<resource>.services.ai.azure.com)")
    p.add_argument("--llm-model",     default="claude-sonnet-4-6")
    p.add_argument("--resource-group", default="rg-wetsanalyse")
    p.add_argument("--location",      default="westeurope")
    p.add_argument("--app-name",      default="wetsanalyse")
    p.add_argument("--db-server-name", default=None)
    p.add_argument("--params-file",   default=str(DEFAULT_PARAMS))
    p.add_argument("--run",           action="store_true",
                   help="Voer de deployment direct uit na het genereren van de params")
    args = p.parse_args()

    tok_frontend = secrets.token_hex(24)
    tok_admin    = secrets.token_hex(24)
    db_pass      = secrets.token_hex(24)
    fernet       = base64.urlsafe_b64encode(os.urandom(32)).decode()
    auth         = base64.b64encode(os.urandom(32)).decode()
    db_server    = args.db_server_name or f"{args.app_name}-db"

    params: dict = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "location":           {"value": args.location},
            "appName":            {"value": args.app_name},
            "dbServerName":       {"value": db_server},
            "llmModel":           {"value": args.llm_model},
            "llmApiBase":         {"value": args.llm_api_base},
            "llmApiKey":          {"value": args.azure_ai_key},
            "llmConfigSecret":    {"value": fernet},
            "apiTokens":          {"value": f"frontend:{tok_frontend}"},
            "adminTokens":        {"value": f"admin:{tok_admin}"},
            "authSecret":         {"value": auth},
            "frontendApiToken":   {"value": tok_frontend},
            "frontendAdminToken": {"value": tok_admin},
            "dbAdminPassword":    {"value": db_pass},
        },
    }

    params_path = Path(args.params_file)
    params_path.write_text(json.dumps(params, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Parameterbestand: {params_path}", file=sys.stderr)
    print("  LET OP: bevat geheimen — verwijder na gebruik.", file=sys.stderr)

    cmd = [
        "az", "deployment", "group", "create",
        "--resource-group", args.resource_group,
        "--template-file", str(TEMPLATE),
        "--parameters", f"@{params_path}",
        "--name", f"{args.app_name}-infra",
        "--output", "json",
    ]

    print(f"\nDeployment-commando:\n  {' '.join(cmd)}\n", file=sys.stderr)

    if args.run:
        print("→ Deployment gestart (10–15 minuten)…", file=sys.stderr)
        result = subprocess.run(cmd)
        if result.returncode == 0:
            print("\n✓ Deployment voltooid.", file=sys.stderr)
            params_path.unlink(missing_ok=True)
            print(f"✓ {params_path} verwijderd.", file=sys.stderr)
            print("\nVolgende stap: ga naar <frontendUrl>/setup voor het eerste beheerdersaccount.", file=sys.stderr)
        else:
            print("\n✗ Deployment mislukt.", file=sys.stderr)
            print(f"  Verwijder na analyse: rm {params_path}", file=sys.stderr)
            sys.exit(result.returncode)
    else:
        print("Voer het commando hierboven uit, of herstart met --run.", file=sys.stderr)
        print(f"Verwijder daarna: rm {params_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
