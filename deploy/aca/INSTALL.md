# Wetsanalyse op Azure Container Apps — installatiehandleiding

Stap-voor-stap uitrol van de Wetsanalyse-stack (API · frontend · PostgreSQL) op **Azure Container
Apps** (Consumption-plan). Geen Kubernetes-kennis nodig: ACA beheert het platform. De database draait
als **Azure Database for PostgreSQL Flexible Server** (beheerd, SSL verplicht).

De drie container-images zijn **publiek** op GHCR (`ghcr.io/palmw01/wetsanalyse-api`,
`-frontend`, `wettenbank-mcp`) — ACA pullt ze zonder pull-secret. Niets te bouwen.

---

## Snelstart — eerste uitrol

Vier stappen. Je hebt alleen je **Azure AI Foundry-key** zelf nodig; alles wordt voor je gegenereerd.

### Stap 0 — Vereisten

```bash
az --version          # Azure CLI ≥ 2.60 (az upgrade)
az login              # inloggen op je Azure-account
az account show       # controleer de actieve subscription
```

### Stap 1 — Resource group aanmaken

Kies een naam en regio. Alle resources (PostgreSQL, CAE, Container Apps) landen in deze group.

```bash
az group create \
  --name rg-wetsanalyse \
  --location westeurope
```

### Stap 2 — Secrets genereren en uitrollen

Één commando. Geef je Azure AI Foundry-key en je Wettenbank MCP-token mee; alle andere geheimen
(tokens, DB-wachtwoord, Fernet-key, Auth.js-secret) worden willekeurig gegenereerd.

```bash
python3 deploy/aca/gen-deploy.py \
    "<azure-ai-foundry-key>" \
    "<wettenbank-token>" \
    --llm-api-base "https://<resource>.services.ai.azure.com" \
    --resource-group rg-wetsanalyse \
    --run
```

Zonder `--run` schrijft het script alleen het parameterbestand (`deploy/aca/params.json`) en print
het `az`-commando — handig om eerst te reviewen.

> **PostgreSQL-servernaam is globaal uniek in Azure.** De default is `wetsanalyse-db`. Als die al
> bestaat, geef dan `--db-server-name wetsanalyse-db-<uniek-suffix>` mee.

De uitrol duurt 5–15 minuten (PostgreSQL). Het script verwijdert `params.json` automatisch na
succes. Verwijder het handmatig als de deployment mislukt: `rm deploy/aca/params.json`.

### Stap 3 — Frontend-URL ophalen

```bash
az deployment group show \
  --resource-group rg-wetsanalyse \
  --name wetsanalyse-infra \
  --query "properties.outputs.frontendUrl.value" \
  --output tsv
```

### Stap 4 — Eerste beheerder registreren

Ga naar `<frontendUrl>/setup` en maak het eerste beheerdersaccount aan. Deze route sluit zichzelf
zodra er één gebruiker in de tabel staat.

---

## GitHub Actions instellen (CI/CD)

Na de eerste uitrol verloopt elke image-update automatisch via `.github/workflows/aca-deploy.yml`.
Dat workflow gebruikt **OIDC (Workload Identity Federation)** — geen client-secret opslaan.

### Eenmalige Azure AD-setup

```bash
# 1. App Registration aanmaken
az ad app create --display-name "wetsanalyse-cicd"

# Noteer de appId (= AZURE_CLIENT_ID) en de tenant uit `az account show` (= AZURE_TENANT_ID).
APP_ID=$(az ad app show --id "wetsanalyse-cicd" --query appId -o tsv 2>/dev/null \
  || az ad app list --display-name "wetsanalyse-cicd" --query "[0].appId" -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
SUB_ID=$(az account show --query id -o tsv)

# 2. Service Principal aanmaken
az ad sp create --id "$APP_ID"

# 3. Federated credential voor de GitHub-repo toevoegen
#    Vervang OWNER en REPO door je GitHub-organisatie/gebruiker en reponaam.
OWNER="palmw01"
REPO="wetsanalyse-ai"

az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters "{
    \"name\": \"github-aca\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:${OWNER}/${REPO}:ref:refs/heads/master\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }"

# 4. Contributor-rechten op de resource group
az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/${SUB_ID}/resourceGroups/rg-wetsanalyse"

echo "AZURE_CLIENT_ID = $APP_ID"
echo "AZURE_TENANT_ID = $TENANT_ID"
echo "AZURE_SUBSCRIPTION_ID = $SUB_ID"
```

### GitHub-secrets en -variabelen

Stel de volgende waarden in via **Settings → Secrets and variables → Actions**:

| Type | Naam | Waarde |
|------|------|--------|
| Secret | `AZURE_CLIENT_ID` | App Registration Client ID |
| Secret | `AZURE_TENANT_ID` | Azure AD Tenant ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | Azure Subscription ID |
| Variable | `ACA_RESOURCE_GROUP` | `rg-wetsanalyse` |
| Variable | `ACA_APP_NAME` | `wetsanalyse` (optioneel, dat is de default) |

Zodra `ACA_RESOURCE_GROUP` ingesteld is, activeert de CI/CD-pipeline automatisch na elke
geslaagde image-build op `master`.

---

## Referentie

### Overlays vergelijken

| Eigenschap | ACA (dit pad) | OpenShift (`deploy/openshift/`) |
|---|---|---|
| Platform | Azure Container Apps (Consumption) | OpenShift namespace |
| Database | Azure DB for PostgreSQL Flexible Server | CloudNativePG of kale Postgres |
| Secrets | ACA-secrets (versleuteld) | Kubernetes Secrets |
| Ingress | Ingebouwd HTTPS, automatisch certificaat | HAProxy-route + TLS edge |
| Schaalbaarheid | min 1 → max 3 replica's per app | Deployment-replicas |
| Auth CI/CD | OIDC (geen client-secret) | Portainer API-key |

### Secrets bijwerken na uitrol

```bash
az containerapp secret set \
  --name wetsanalyse-api \
  --resource-group rg-wetsanalyse \
  --secrets llm-api-key=<nieuwe-waarde>

# Herstarten om de nieuwe secret op te pikken:
az containerapp revision restart \
  --name wetsanalyse-api \
  --resource-group rg-wetsanalyse \
  --revision $(az containerapp show \
      --name wetsanalyse-api -g rg-wetsanalyse \
      --query "properties.latestRevisionName" -o tsv)
```

### Custom domein toevoegen

```bash
az containerapp hostname add \
  --name wetsanalyse-frontend \
  --resource-group rg-wetsanalyse \
  --hostname wetsanalyse.example.nl

# Na het toevoegen: zet ook AUTH_URL bij op het custom domein.
az containerapp update \
  --name wetsanalyse-frontend \
  --resource-group rg-wetsanalyse \
  --set-env-vars "AUTH_URL=https://wetsanalyse.example.nl"
```

### Schalen

```bash
az containerapp update \
  --name wetsanalyse-api \
  --resource-group rg-wetsanalyse \
  --min-replicas 2 \
  --max-replicas 5
```

### Troubleshooting

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| API `fout: database verbinding` | Firewall-regel ontbreekt of DB nog niet klaar | Wacht 5 min na uitrol; check `pgFirewall` |
| Frontend 500 bij login | `AUTH_SECRET` of `AUTH_URL` verkeerd | Check env-vars via `az containerapp show` |
| API 401 op alle endpoints | `WETSANALYSE_API_TOKENS` leeg of format fout | Verwacht formaat: `id:token` |
| PostgreSQL connectie weigert SSL | `ssl=require` ontbreekt in `DATABASE_URL` | Controleer via `az containerapp show ... --query "properties.template.containers[0].env"` |
| CI/CD deployt niet | `ACA_RESOURCE_GROUP` variabele leeg | Stel in via GitHub Settings → Variables |
| Image-update zichtbaar maar app oud | ACA cached de `:latest` tag | Gebruik SHA-tags (workflow doet dit al) |
