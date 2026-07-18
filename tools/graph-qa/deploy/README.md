# graph-qa — deployment (Portainer, intern)

De graph-qa-agent vervangt de n8n-chatbot. De Wetsanalyse-API-chatproxy roept 'm aan op
`http://graph-qa:8080/v1/n8n-chat` (server→server via het gedeelde Docker-netwerk). **Geen host-poort,
geen publieke NPM-host nodig.** Image van GHCR via `.github/workflows/graph-qa-docker-publish.yml`.

## 1. Host-secrets (eenmalig, op de host)

Drie bestanden in `SECRETS_DIR` (Synology: `/volume1/docker/secrets/graph-qa`), leesbaar voor de
non-root container-user (uid 10001) → **chmod 644**:

```bash
SECRETS_DIR=/volume1/docker/secrets/graph-qa
sudo mkdir -p "$SECRETS_DIR"
echo -n "<GRAPHDB_TOKEN>"        | sudo tee "$SECRETS_DIR/graphdb_token"        >/dev/null
echo -n "<AZURE_FOUNDRY_API_KEY>"| sudo tee "$SECRETS_DIR/azure_foundry_api_key">/dev/null
echo -n "<QA_API_TOKEN>"         | sudo tee "$SECRETS_DIR/qa_api_token"         >/dev/null   # = chat_secret
sudo chmod 755 "$SECRETS_DIR"; sudo chmod 644 "$SECRETS_DIR"/*
```
De waarden staan nu in `tools/graph-qa/.env`. `qa_api_token` is het gedeelde chat-secret (zie stap 3).

## 2. Stack

`deploy/docker-compose.yml`. Niet-geheime stack-env (Portainer of CI):
`GRAPH_QA_IMAGE`, `PROXY_NETWORK` (default `homeinfra_internal`), `SECRETS_DIR`,
`AZURE_FOUNDRY_BASE_URL`, `LLM_MODEL`, `GRAPHDB_MCP_URL`, `SIMILARITY_INDEX` (`bwb_similarity`),
`OTEL_EXPORTER_OTLP_ENDPOINT` (optioneel). Secrets gaan via `*_FILE` → `/run/secrets`. Durabel
geheugen op het `graph_qa_data`-volume (`/data`).

**Health:** de container heeft een healthcheck op `/health`; de CI-deploy faalt als de container niet
`(healthy)` wordt. Wil je een **externe** health-URL (monitoring): voeg in NPM een proxy-host
`graph-qa.ipalm.nl` → `graph-qa:8080` toe en zet `vars.GRAPH_QA_HEALTH_URL=https://graph-qa.ipalm.nl/health`
(dan doet de CI ook een externe verificatie). Optioneel — intern werkt zonder.

## 3. n8n vervangen (config-swap in de webapp)

In `/beheer` → kennisgraaf-chatbot (of admin-API `PUT /v1/admin/settings`):
- **Webhook-URL:** `http://graph-qa:8080/v1/n8n-chat`
- **Secret:** de waarde van `qa_api_token`
- **Ingeschakeld:** aan

De API-chatproxy stuurt `{action, sessionId, chatInput}` + `X-Chat-Secret`; graph-qa antwoordt met
`{output}` (antwoord + bronnen). `sessionId` wordt `conversation_id` → geheugen-continuïteit per
gesprek. Verifieer: `GET /v1/chat/health` groen → stel via de chatbel een vraag.

## 4. n8n uitfaseren

Na verificatie de `n8n`-stack stoppen/verwijderen (Portainer), tenzij die nog voor iets anders draait.

## CI-driven deploy (later)

Zet `secrets.PORTAINER_URL` + `secrets.PORTAINER_API_KEY` en `vars.PORTAINER_GRAPH_QA_STACK_ID`
(+ `vars.LLM_MODEL`, `vars.GRAPHDB_MCP_URL`, `vars.AZURE_FOUNDRY_BASE_URL`, `vars.GRAPH_QA_SECRETS_DIR`,
optioneel `vars.GRAPH_QA_SIMILARITY_INDEX`/`vars.GRAPH_QA_HEALTH_URL`). Dan redeployt de workflow bij
elke wijziging in `tools/graph-qa/**` op digest, met container-health-gate.
