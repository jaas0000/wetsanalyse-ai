// deploy/aca/main.bicep
// Volledige Azure Container Apps-stack voor Wetsanalyse.
// Bevat: PostgreSQL Flexible Server · Container Apps Environment · API · Frontend.
//
// Eerste uitrol (eenmalig, vanuit de projectroot):
//   python3 deploy/aca/gen-deploy.py "<azure-ai-key>" "<wettenbank-token>" \
//       --llm-api-base https://<resource>.services.ai.azure.com [--run]
//
// Of handmatig na gen-deploy.py (zonder --run):
//   az deployment group create \
//     --resource-group rg-wetsanalyse \
//     --template-file deploy/aca/main.bicep \
//     --parameters @deploy/aca/params.json
//
// CI/CD-updates lopen daarna via .github/workflows/aca-deploy.yml.

@description('Azure-regio; erft van de resource group.')
param location string = resourceGroup().location

@description('Naam-prefix voor alle resources. Container Apps worden <appName>-api en <appName>-frontend.')
param appName string = 'wetsanalyse'

@description('PostgreSQL-servernaam (moet globaal uniek zijn in Azure; standaard: <appName>-db).')
param dbServerName string = '${appName}-db'

// ── LLM-configuratie ─────────────────────────────────────────────────────────
@description('LLM-modelnaam (bijv. claude-sonnet-4-6).')
param llmModel string

@description('Azure AI Foundry base-URL (bijv. https://<resource>.services.ai.azure.com).')
param llmApiBase string

@description('LLM-provider (default: azure_ai voor Azure AI Foundry / MaaS).')
param llmProvider string = 'azure_ai'

// ── Secrets (@secure → verschijnen niet in de deployment-history) ─────────────
@description('Azure AI Foundry API-key.')
@secure()
param llmApiKey string

@description('Wettenbank MCP-token (API → MCP-server).')
@secure()
param wettenbankToken string

@description('Fernet-masterkey voor versleuteling-at-rest van via de admin-UI opgeslagen API-keys.')
@secure()
param llmConfigSecret string

@description('API-clienttokens in "id:token[,id2:token2]"-formaat (zie api/CLAUDE.md).')
@secure()
param apiTokens string

@description('API-admintokens in "id:token[,id2:token2]"-formaat (voor /v1/admin/*).')
@secure()
param adminTokens string

@description('Auth.js-sessiesecret (minimaal 32 bytes, base64-encoded).')
@secure()
param authSecret string

@description('Frontend API-token — moet overeenkomen met een entry in apiTokens.')
@secure()
param frontendApiToken string

@description('Frontend admin-token — moet overeenkomen met een entry in adminTokens.')
@secure()
param frontendAdminToken string

@description('PostgreSQL admin-wachtwoord.')
@secure()
param dbAdminPassword string

// ─────────────────────────────────────────────────────────────────────────────
// 1. PostgreSQL Flexible Server (v16, Burstable B1ms)
// ─────────────────────────────────────────────────────────────────────────────
resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: dbServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: 'wetsanalyse'
    administratorLoginPassword: dbAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
    }
  }
}

// Azure Container Apps maakt gebruik van outbound-IPs in het Azure-datacentrum.
// De speciale regel 0.0.0.0–0.0.0.0 laat alle Azure-services toe (geen publiek internet).
resource pgFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: pgServer
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: pgServer
  name: 'wetsanalyse'
  properties: {
    charset: 'utf8'
    collation: 'en_US.utf8'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Container Apps Environment (Consumption — betaal per gebruik)
// ─────────────────────────────────────────────────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}'
  location: location
  properties: {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. API Container App (internal ingress — alleen bereikbaar binnen de environment)
// ─────────────────────────────────────────────────────────────────────────────
// asyncpg vereist ssl=require voor Azure PostgreSQL Flexible Server.
var dbUrl = 'postgresql+asyncpg://wetsanalyse:${dbAdminPassword}@${pgServer.properties.fullyQualifiedDomainName}:5432/wetsanalyse?ssl=require'

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appName}-api'
  location: location
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: false   // niet publiek — alleen bereikbaar vanuit de CAE (de BFF/frontend)
        targetPort: 3000
        transport: 'auto'
      }
      secrets: [
        { name: 'llm-api-key',       value: llmApiKey }
        { name: 'wettenbank-token',  value: wettenbankToken }
        { name: 'llm-config-secret', value: llmConfigSecret }
        { name: 'api-tokens',        value: apiTokens }
        { name: 'admin-tokens',      value: adminTokens }
        { name: 'database-url',      value: dbUrl }
      ]
    }
    template: {
      volumes: [
        {
          name: 'api-secrets'
          storageType: 'Secret'
          secrets: [
            { secretRef: 'llm-api-key',       path: 'llm_api_key' }
            { secretRef: 'wettenbank-token',   path: 'wettenbank_token' }
            { secretRef: 'llm-config-secret',  path: 'llm_config_secret' }
            { secretRef: 'api-tokens',         path: 'api_tokens' }
            { secretRef: 'admin-tokens',       path: 'admin_tokens' }
            { secretRef: 'database-url',       path: 'database_url' }
          ]
        }
      ]
      containers: [
        {
          name: 'api'
          image: 'ghcr.io/palmw01/wetsanalyse-api:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          volumeMounts: [
            {
              volumeName: 'api-secrets'
              mountPath: '/run/secrets'
            }
          ]
          env: [
            { name: 'LLM_PROVIDER',              value: llmProvider }
            { name: 'LLM_MODEL',                 value: llmModel }
            { name: 'LLM_API_BASE',              value: llmApiBase }
            { name: 'WETSANALYSE_AUTH_REQUIRED', value: '1' }
            { name: 'HOME',                      value: '/tmp' }
            // Secrets worden als bestand gemount op /run/secrets/ — *_FILE wijst naar het pad.
            { name: 'LLM_API_KEY_FILE',              value: '/run/secrets/llm_api_key' }
            { name: 'WETTENBANK_TOKEN_FILE',         value: '/run/secrets/wettenbank_token' }
            { name: 'LLM_CONFIG_SECRET_FILE',        value: '/run/secrets/llm_config_secret' }
            { name: 'WETSANALYSE_API_TOKENS_FILE',   value: '/run/secrets/api_tokens' }
            { name: 'WETSANALYSE_ADMIN_TOKENS_FILE', value: '/run/secrets/admin_tokens' }
            { name: 'DATABASE_URL_FILE',             value: '/run/secrets/database_url' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 15
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Frontend Container App (external HTTPS ingress — publiek bereikbaar)
// ─────────────────────────────────────────────────────────────────────────────
// De BFF bereikt de API intern via het CAE-DNS: https://<appName>-api.<defaultDomain>.
var apiInternalUrl    = 'https://${appName}-api.${cae.properties.defaultDomain}'
var frontendPublicUrl = 'https://${appName}-frontend.${cae.properties.defaultDomain}'

resource frontendApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appName}-frontend'
  location: location
  dependsOn: [apiApp]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        { name: 'api-token',       value: frontendApiToken }
        { name: 'admin-api-token', value: frontendAdminToken }
        { name: 'auth-secret',     value: authSecret }
      ]
    }
    template: {
      volumes: [
        {
          name: 'frontend-secrets'
          storageType: 'Secret'
          secrets: [
            { secretRef: 'api-token',       path: 'frontend_api_token' }
            { secretRef: 'admin-api-token', path: 'frontend_admin_token' }
            { secretRef: 'auth-secret',     path: 'frontend_auth_secret' }
          ]
        }
      ]
      containers: [
        {
          name: 'frontend'
          image: 'ghcr.io/palmw01/wetsanalyse-frontend:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          volumeMounts: [
            {
              volumeName: 'frontend-secrets'
              mountPath: '/run/secrets'
            }
          ]
          env: [
            { name: 'NODE_ENV',              value: 'production' }
            { name: 'API_BASE_URL',          value: apiInternalUrl }
            { name: 'AUTH_URL',              value: frontendPublicUrl }
            { name: 'AUTH_TRUST_HOST',       value: 'true' }
            { name: 'HOME',                  value: '/tmp' }
            // Secrets worden als bestand gemount op /run/secrets/ — *_FILE wijst naar het pad.
            { name: 'API_TOKEN_FILE',        value: '/run/secrets/frontend_api_token' }
            { name: 'ADMIN_API_TOKEN_FILE',  value: '/run/secrets/frontend_admin_token' }
            { name: 'AUTH_SECRET_FILE',      value: '/run/secrets/frontend_auth_secret' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 15
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outputs (zichtbaar na `az deployment group show`)
// ─────────────────────────────────────────────────────────────────────────────
output frontendUrl     string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output apiInternalFqdn string = apiApp.properties.configuration.ingress.fqdn
output dbServerFqdn    string = pgServer.properties.fullyQualifiedDomainName
