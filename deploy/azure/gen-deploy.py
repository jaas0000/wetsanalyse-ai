#!/usr/bin/env python3
"""Genereer een Bicep-parameterbestand en rol de Wetsanalyse-stack uit op Azure.

Gebruik:
    python3 deploy/azure/gen-deploy.py "<azure-ai-key>" \\
        --llm-api-base https://<resource>.services.ai.azure.com \\
        --license-file /pad/naar/graphdb.license \\
        [--resource-group rg-wetsanalyse] [--location westeurope] \\
        [--what-if | --run]

Drie modi:
    (geen vlag)   genereer params.json en print het az-commando — verandert niets
    --what-if     laat Azure tonen wat de deployment zou wijzigen — maakt niets aan
    --run         voer de deployment daadwerkelijk uit

Vereisten:
    - az (Azure CLI) geïnstalleerd en ingelogd: az login
    - Resource group bestaat: az group create -n rg-wetsanalyse -l westeurope

LET OP: elke run genereert VERSE tokens en wachtwoorden. Op een draaiende omgeving betekent
opnieuw deployen dus dat sessies vervallen en de admin-tokens wijzigen. Voor een omgeving die je
aan- en uitzet is dat juist wenselijk; wil je ze stabiel houden, geef dan een bestaand
parameterbestand mee met --params-file en laat dit script het niet overschrijven.
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
    p.add_argument("azure_ai_key", nargs="?", default=os.environ.get("AZURE_AI_KEY"),
                   help="Azure AI Foundry API-key (of via AZURE_AI_KEY env-variabele)")
    p.add_argument("--llm-api-base", required=True,
                   help="Azure AI Foundry base-URL (bijv. https://<resource>.services.ai.azure.com)")
    p.add_argument("--llm-model", default="claude-sonnet-4-6")
    p.add_argument("--license-file", default=os.environ.get("GRAPHDB_LICENSE_FILE"),
                   help="Pad naar graphdb.license. Zonder licentie komt de graaf read-only op en "
                        "faalt de import-job — GraphDB 11 staat schrijven alleen met licentie toe.")
    p.add_argument("--resource-group", default="rg-wetsanalyse")
    p.add_argument("--location", default="westeurope")
    p.add_argument("--app-name", default="wetsanalyse")
    p.add_argument("--db-server-name", default=None)
    p.add_argument("--params-file", default=str(DEFAULT_PARAMS))
    p.add_argument("--what-if", action="store_true",
                   help="Toon wat de deployment zou wijzigen; maak niets aan.")
    p.add_argument("--run", action="store_true",
                   help="Voer de deployment direct uit na het genereren van de params")
    args = p.parse_args()

    if not args.azure_ai_key:
        p.error("azure_ai_key is vereist — geef het als argument of zet AZURE_AI_KEY in de omgeving.")
    if args.what_if and args.run:
        p.error("--what-if en --run sluiten elkaar uit.")

    licentie_b64 = ""
    if args.license_file:
        lic = Path(args.license_file)
        if not lic.is_file():
            p.error(f"licentiebestand niet gevonden: {lic}")
        licentie_b64 = base64.b64encode(lic.read_bytes()).decode()
    else:
        print("! Geen --license-file: de graaf komt read-only op en de import-job zal falen.",
              file=sys.stderr)

    tok_frontend = secrets.token_hex(24)
    tok_admin = secrets.token_hex(24)
    tok_qa = secrets.token_hex(24)      # frontend ↔ graph-qa (QA_API_TOKEN)
    # graph-qa eist fail-closed een GRAPHDB_TOKEN (require_graph). Binnen deze omgeving is de graaf
    # alleen intern bereikbaar en draait GraphDB zonder eigen security, dus dit token is daar geen
    # slot — het wordt wel meegestuurd. Zelf genereren is beter dan het LXC-token hierheen kopiëren.
    tok_graphdb = secrets.token_hex(24)
    db_pass = secrets.token_hex(24)
    fernet = base64.urlsafe_b64encode(os.urandom(32)).decode()
    auth = base64.b64encode(os.urandom(32)).decode()
    db_server = args.db_server_name or f"{args.app_name}-db"

    params: dict = {
        "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
        "contentVersion": "1.0.0.0",
        "parameters": {
            "location": {"value": args.location},
            "appName": {"value": args.app_name},
            "dbServerName": {"value": db_server},
            "llmModel": {"value": args.llm_model},
            "llmApiBase": {"value": args.llm_api_base},
            "llmApiKey": {"value": args.azure_ai_key},
            "llmConfigSecret": {"value": fernet},
            "apiTokens": {"value": f"frontend:{tok_frontend}"},
            "adminTokens": {"value": f"admin:{tok_admin}"},
            "authSecret": {"value": auth},
            "frontendApiToken": {"value": tok_frontend},
            "frontendAdminToken": {"value": tok_admin},
            "dbAdminPassword": {"value": db_pass},
            "graphdbToken": {"value": tok_graphdb},
            "qaApiToken": {"value": tok_qa},
            "graphdbLicenseBase64": {"value": licentie_b64},
        },
    }

    params_path = Path(args.params_file)
    params_path.write_text(json.dumps(params, indent=2, ensure_ascii=False), encoding="utf-8")
    params_path.chmod(0o600)
    print(f"✓ Parameterbestand: {params_path}", file=sys.stderr)
    print("  LET OP: bevat geheimen — verwijder na gebruik.", file=sys.stderr)

    verb = "what-if" if args.what_if else "create"
    cmd = [
        "az", "deployment", "group", verb,
        "--resource-group", args.resource_group,
        "--template-file", str(TEMPLATE),
        "--parameters", f"@{params_path}",
        "--name", f"{args.app_name}-infra",
    ]
    if not args.what_if:
        cmd += ["--output", "json"]

    print(f"\nCommando:\n  {' '.join(cmd)}\n", file=sys.stderr)

    if not (args.run or args.what_if):
        print("Voer het commando hierboven uit, of herstart met --what-if of --run.", file=sys.stderr)
        print(f"Verwijder daarna: rm {params_path}", file=sys.stderr)
        return

    if args.what_if:
        print("→ what-if: Azure toont de voorgenomen wijzigingen; er wordt niets aangemaakt.",
              file=sys.stderr)
    else:
        print("→ Deployment gestart (10–15 minuten; PostgreSQL is de trage stap)…", file=sys.stderr)

    result = subprocess.run(cmd)
    params_path.unlink(missing_ok=True)
    print(f"\n✓ {params_path} verwijderd.", file=sys.stderr)

    if result.returncode != 0:
        print("✗ Mislukt — zie de fout hierboven.", file=sys.stderr)
        sys.exit(result.returncode)

    if args.run:
        print("\n✓ Deployment voltooid. Twee stappen om de omgeving bruikbaar te maken:", file=sys.stderr)
        print(f"  1. Vul de graaf:  az containerapp job start -n {args.app_name}-bwb-import "
              f"-g {args.resource_group}", file=sys.stderr)
        print("  2. Maak de eerste beheerder aan op <frontendUrl>/setup", file=sys.stderr)


if __name__ == "__main__":
    main()
