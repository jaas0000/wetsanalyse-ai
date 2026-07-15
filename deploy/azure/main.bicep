// deploy/azure/main.bicep
// Azure Container Apps-stack voor Wetsanalyse — 4 componenten:
//   PostgreSQL Flexible Server · Wettenbank MCP · API · Frontend
//
// Deployment (vanuit de projectroot):
//   python3 deploy/azure/gen-deploy.py "<azure-ai-key>" \
//       --llm-api-base https://<resource>.services.ai.azure.com [--run]

@description('Azure-regio; erft van de resource group.')
param location string = resourceGroup().location

@description('Naam-prefix voor alle resources.')
param appName string = 'wetsanalyse'

@description('PostgreSQL-servernaam (moet globaal uniek zijn in Azure).')
param dbServerName string = '${appName}-db'

// ── LLM-configuratie ─────────────────────────────────────────────────────────
@description('LLM-modelnaam (bijv. claude-sonnet-4-6).')
param llmModel string

@description('Azure AI Foundry base-URL.')
param llmApiBase string

@description('LLM-provider (default: azure_ai).')
param llmProvider string = 'azure_ai'

// ── Secrets ───────────────────────────────────────────────────────────────────
@secure()
param llmApiKey string

@secure()
param llmConfigSecret string

@secure()
param apiTokens string

@secure()
param adminTokens string

@secure()
param authSecret string

@secure()
param frontendApiToken string

@secure()
param frontendAdminToken string

@secure()
param dbAdminPassword string

// ─────────────────────────────────────────────────────────────────────────────
// 1. PostgreSQL Flexible Server
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
  }
}

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
// 2. Container Apps Environment
// ─────────────────────────────────────────────────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${appName}'
  location: location
  properties: {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wettenbank MCP (internal — alleen bereikbaar binnen de CAE)
// ─────────────────────────────────────────────────────────────────────────────
resource mcpApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appName}-mcp'
  location: location
  dependsOn: [cae]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'mcp'
          image: 'ghcr.io/palmw01/wettenbank-mcp:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'MCP_TRANSPORT',     value: 'http' }
            { name: 'PORT',              value: '3000' }
            { name: 'MCP_ALLOW_NO_AUTH', value: '1' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. API Container App (internal)
// ─────────────────────────────────────────────────────────────────────────────
var dbUrl = 'postgresql+asyncpg://wetsanalyse:${dbAdminPassword}@${pgServer.properties.fullyQualifiedDomainName}:5432/wetsanalyse?ssl=require'
// Interne app-FQDN dragen het verplichte `.internal.`-segment (`<app>.internal.<defaultDomain>`);
// die niet met de hand opbouwen maar uit de resource lezen, anders resolvet de host niet.
var mcpInternalUrl = 'https://${mcpApp.properties.configuration.ingress.fqdn}/mcp'

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${appName}-api'
  location: location
  dependsOn: [pgDatabase, mcpApp]
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: false
        targetPort: 3000
        transport: 'auto'
      }
      secrets: [
        { name: 'llm-api-key',       value: llmApiKey }
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
            { name: 'LLM_PROVIDER',                value: llmProvider }
            { name: 'LLM_MODEL',                   value: llmModel }
            { name: 'LLM_API_BASE',                value: llmApiBase }
            { name: 'WETTENBANK_MCP_URL',          value: mcpInternalUrl }
            { name: 'WETSANALYSE_AUTH_REQUIRED',   value: '1' }
            { name: 'HOME',                        value: '/tmp' }
            { name: 'LLM_API_KEY_FILE',              value: '/run/secrets/llm_api_key' }
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
// 5. Frontend Container App (external HTTPS)
// ─────────────────────────────────────────────────────────────────────────────
// Interne API-FQDN uit de resource (bevat `.internal.`); de externe frontend-URL mág met de hand
// (extern = `<app>.<defaultDomain>`) — een `.ingress.fqdn`-referentie zou hier een cycle geven
// omdat frontendPublicUrl binnen frontendApp zelf als AUTH_URL wordt gebruikt.
var apiInternalUrl    = 'https://${apiApp.properties.configuration.ingress.fqdn}'
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
// Outputs
// ─────────────────────────────────────────────────────────────────────────────
output frontendUrl     string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output apiInternalFqdn string = apiApp.properties.configuration.ingress.fqdn
output mcpInternalFqdn string = mcpApp.properties.configuration.ingress.fqdn
output dbServerFqdn    string = pgServer.properties.fullyQualifiedDomainName
