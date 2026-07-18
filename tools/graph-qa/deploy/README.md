# graph-qa — deployment (Portainer, intern)

De graph-qa-agent draait als intern-only Portainer-stack. De Wetsanalyse-API-chatproxy roept 'm aan op
`http://graph-qa:8080/v1/chat-webhook` (server→server via het gedeelde Docker-netwerk). **Geen
host-poort, geen publieke NPM-host nodig.** Image van GHCR via
`.github/workflows/graph-qa-docker-publish.yml`.

## 1. Host-secrets (eenmalig, op de host)

Twee bestanden in `SECRETS_DIR` (Synology: `/volume1/docker/secrets/graph-qa`), leesbaar voor de
non-root container-user (uid 10001) → **chmod 644**:

```bash
SECRETS_DIR=/volume1/docker/secrets/graph-qa
sudo mkdir -p "$SECRETS_DIR"
echo -n "<GRAPHDB_TOKEN>"        | sudo tee "$SECRETS_DIR/graphdb_token"        >/dev/null
echo -n "<AZURE_FOUNDRY_API_KEY>"| sudo tee "$SECRETS_DIR/azure_foundry_api_key">/dev/null
sudo chmod 755 "$SECRETS_DIR"; sudo chmod 644 "$SECRETS_DIR"/*
```
De waarden staan in `tools/graph-qa/.env`. **Geen chat-secret nodig:** de service is intern-only.

## 2. Stack

`deploy/docker-compose.yml`. Niet-geheime stack-env (Portainer of CI):
`GRAPH_QA_IMAGE`, `PROXY_NETWORK` (default `homeinfra_internal`), `SECRETS_DIR`,
`AZURE_FOUNDRY_BASE_URL`, `LLM_MODEL`, `GRAPHDB_MCP_URL`, `SIMILARITY_INDEX` (`bwb_similarity`),
`OTEL_EXPORTER_OTLP_ENDPOINT` (optioneel). Secrets via `*_FILE` → `/run/secrets`. Durabel geheugen
op het `graph_qa_data`-volume (`/data`).

**Health:** de container heeft een healthcheck op `/health`; de CI-deploy faalt als de container niet
`(healthy)` wordt. Optioneel een externe health-URL: NPM proxy-host `graph-qa.ipalm.nl` →
`graph-qa:8080` + `vars.GRAPH_QA_HEALTH_URL=https://graph-qa.ipalm.nl/health`.

## 3. Chatbot koppelen (config-swap in de webapp)

In `/beheer` → kennisgraaf-chatbot (of admin-API `PUT /v1/admin/settings`):
- **Webhook-URL:** `http://graph-qa:8080/v1/chat-webhook`
- **Secret:** leeg laten (intern-only, geen slot).
- **Ingeschakeld:** aan

De API-chatproxy stuurt `{action, sessionId, chatInput}`; graph-qa antwoordt met `{output}`
(antwoord + bronlinks). `sessionId` → `conversation_id` → geheugen-continuïteit per gesprek.
Verifieer via de chatbel.

> Wil je graph-qa tóch publiek exposen (NPM-host): zet dan `QA_API_TOKEN_FILE=/run/secrets/qa_api_token`
> in de stack, leg `qa_api_token` op de host, en vul dat als chat-secret in `/beheer`.

## CI-driven deploy

Zet `secrets.PORTAINER_URL` + `secrets.PORTAINER_API_KEY` en `vars.PORTAINER_GRAPH_QA_STACK_ID`
(+ `vars.LLM_MODEL`, `vars.GRAPHDB_MCP_URL`, `vars.AZURE_FOUNDRY_BASE_URL`, `vars.GRAPH_QA_SECRETS_DIR`,
optioneel `vars.GRAPH_QA_SIMILARITY_INDEX`/`vars.GRAPH_QA_HEALTH_URL`). Dan redeployt de workflow bij
elke wijziging in `tools/graph-qa/**` op digest, met container-health-gate.
