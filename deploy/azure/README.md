# Wetsanalyse — Azure deployment

Deployt de volledige Wetsanalyse-stack op **Azure Container Apps** met vier componenten:

| Component | Image | Bereikbaar |
|---|---|---|
| PostgreSQL | Azure Database for PostgreSQL | intern |
| Wettenbank MCP | `ghcr.io/palmw01/wettenbank-mcp` | intern |
| API | `ghcr.io/palmw01/wetsanalyse-api` | intern |
| Frontend | `ghcr.io/palmw01/wetsanalyse-frontend` | publiek HTTPS |

---

## Azure deployment

### Vereisten

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) geïnstalleerd
- Azure-subscription met rechten om resources aan te maken
- Python 3.10+

### Stap 1 — Inloggen en resource group aanmaken

```bash
az login

az group create --name rg-wetsanalyse --location westeurope
```

### Stap 2 — Deployment uitvoeren

```bash
python3 deploy/azure/gen-deploy.py "<azure-ai-foundry-key>" \
    --llm-api-base "https://<resource>.services.ai.azure.com" \
    --resource-group rg-wetsanalyse \
    --run
```

Het script genereert alle benodigde tokens en wachtwoorden automatisch.
De deployment duurt 10–15 minuten. Daarna verschijnt de frontend-URL in de output.

### Stap 3 — Eerste beheerdersaccount

Ga naar `<frontendUrl>/setup` en registreer de eerste beheerder.

---

## Lokaal draaien

Dezelfde vier containers lokaal opstarten via Docker of Podman.

### Vereisten

- Docker + Docker Compose, of Podman + podman-compose
- Python 3.10+

### Stap 1 — Configuratie

```bash
cd deploy/azure
cp .env.example .env
# Vul LLM_API_BASE, LLM_API_KEY en AUTH_URL in
```

### Stap 2 — Secrets genereren

```bash
python3 gen-secrets.py
```

### Stap 3 — Stack starten

```bash
docker compose up -d
# of:
podman-compose up -d
```

De frontend is bereikbaar op `http://localhost:3000`.
Ga naar `/setup` voor het eerste beheerdersaccount.

---

## Opruimen (Azure)

Verwijder de volledige resource group om alle kosten te stoppen:

```bash
az group delete --name rg-wetsanalyse --yes
```
