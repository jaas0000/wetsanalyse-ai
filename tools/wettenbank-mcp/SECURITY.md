# Beveiliging & logging — Wettenbank-MCP (HTTP-modus)

Operationele documentatie voor de gecontaineriseerde HTTP-deployment, afgestemd op
**BIO2 / NEN-EN-ISO/IEC 27002:2022**, **AVG** en (waar van toepassing) **NIS2**.

> De stdio-modus (lokaal subproces op de machine van de gebruiker) heeft geen
> netwerk-attackoppervlak en valt buiten deze documentatie.

## Configuratie (environment)

| Variabele | Default | Doel |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Zet op `http` voor de netwerkservice. |
| `PORT` | `3000` | Luisterpoort (HTTP-modus). |
| `MCP_AUTH_TOKENS` | — | Per-client tokens: `"belastingdienst:abc, analist-jan:def"`. **Aanbevolen.** |
| `MCP_AUTH_TOKEN` | — | Legacy enkelvoud → clientId `default`. Fallback. |
| `MCP_AUTH_TOKENS_FILE` | — | Pad naar bestand met de tokenlijst (Docker secret / vault). Voorrang op inline. |
| `MCP_AUTH_TOKEN_FILE` | — | Pad naar bestand met de legacy enkelvoudtoken. |
| `OIDC_ISSUER` | — | Zet OIDC-auth aan (bijv. `https://login.example.nl/realms/x`). |
| `OIDC_JWKS_URI` | `${issuer}/.well-known/jwks.json` | JWKS-endpoint voor signatuurvalidatie. |
| `OIDC_AUDIENCE` | — | Verwachte `aud`-claim (aanbevolen). |
| `OIDC_CLIENT_CLAIM` | `azp` | Claim waaruit `clientId` komt; valt terug op `sub`. |
| `MCP_ALLOW_NO_AUTH` | — | `1` = bewust zonder auth starten (alleen achter vertrouwd netwerk). |
| `MCP_RATE_BURST` | `60` | Max. burst (emmergrootte) per IP. |
| `MCP_RATE_PER_MIN` | `120` | Aanvulsnelheid per IP per minuut. |
| `MCP_SESSION_IDLE_MS` | `1800000` | Idle-sessie-opruiming (30 min). |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `LOG_ZOEKTERMEN` | — | `1` = log volledige zoektermen. **Alleen debug** (AVG-risico). |

Tokens horen in een secret-store (Portainer stack-env → bij voorkeur een vault) en worden
**periodiek geroteerd**. Eén client intrekken = zijn `id:token`-paar verwijderen.

## Authenticatie

Per-client bearer-tokens, constant-tijd vergeleken (geen timing-oracle). Elke afnemer heeft een
eigen `clientId` die in de auditlog belandt, zodat aanroepen herleidbaar zijn. `/health` is
bewust auth-vrij (healthcheck Portainer/Azure). TLS wordt door Nginx Proxy Manager getermineerd.

**OAuth2/OIDC (optioneel, dormant tenzij `OIDC_ISSUER` is gezet).** Een binnenkomende
JWT-bearer wordt gevalideerd tegen de IdP: signatuur via JWKS, plus `iss`/`aud`/`exp`/`nbf`.
De `clientId` komt uit `OIDC_CLIENT_CLAIM` (default `azp`, val terug op `sub`). De statische/
file-tokens blijven werken als fallback, zodat migratie geleidelijk kan. Implementatie:
`src/oidc.ts` (met de vetted `jose`-library); zie issue #16.

**Secret-management.** Tokens kunnen uit een **bestand** komen (`*_FILE`-env) i.p.v. inline env —
het standaardpatroon voor Docker secrets en vault-agents. Rotatie: vervang een `id:token`-paar
(of het secret-bestand) en herdeploy; per-client intrekken raakt de andere clients niet. Zie issue #18.

## Logging

Gestructureerde JSON, één regel per event naar **stderr**. De app schrijft geen eigen
logbestanden; de containerruntime/SIEM vangt stderr op (12-factor + NORA "centrale verzameling").

**Categorieën:** `functioneel` (verkeer/sessies) · `audit` (welke client riep welke tool op welke
wet aan) · `security` (auth-weigeringen, rate-limit-overschrijdingen).

**Voorbeeld audit-regel:**
```json
{"ts":"2026-06-09T07:11:20.573Z","niveau":"info","categorie":"audit","bericht":"tool aangeroepen",
 "tool":"wettenbank_artikel","clientId":"belastingdienst","sessionId":"…","bwbId":"BWBR0004770",
 "artikel":"9","uitkomst":"ok","duur_ms":142}
```

**Niet gelogd (AVG + secrets):** de bearer-token en `Authorization`-header (defensief gestript in
`logger.ts`), en **rauwe zoektermen** — die kunnen onthullen wat een ambtenaar onderzoekt. Default
wordt alleen de lengte gelogd (`zoekterm_lengte` + `[geredacteerd]`).

**Clock sync (ISO 27002 §8.17):** tijdstempels in UTC (ISO-8601). Zorg dat de container-host
NTP-gesynchroniseerd is, anders zijn de logs forensisch niet te correleren.

## Bewaartermijn (voorstel — AVG-onderbouwing vereist)

Er is geen vaste wettelijke termijn; de termijn is functioneel bepaald met doelbinding.

| Logsoort | Doel | Voorstel |
|---|---|---|
| `functioneel` | Operationele troubleshooting | 90 dagen |
| `audit` | Verantwoording/herleidbaarheid | 6–12 maanden |
| `security` | Incidentonderzoek/detectie | 6–12 maanden |

Vast te leggen mét verwerkingsdoel in het verwerkingsregister van de afnemer.

## SIEM-koppeling

De app levert vendor-neutrale JSON op stdout/stderr. Afspraak met de afnemer: de log-shipper
(bijv. Fluent Bit/Filebeat → centraal SIEM) pikt de containerlogs op. Geen wijziging aan de app
nodig; alert-regels (herhaalde 401's, 429-pieken) horen in het SIEM.

## CI-borging (ISO 27002 §8.8 kwetsbaarhedenbeheer)

`.github/workflows/docker-publish.yml`:
- `test`-job: `npm test` + `npm audit --audit-level=high` (faalt bij high/critical).
- Trivy image-scan: SARIF → GitHub Security-tab; aparte gate faalt bij `CRITICAL`.
- SBOM + provenance als attestatie bij de gepushte image.
- `.github/dependabot.yml`: wekelijkse update-PR's (npm, docker, github-actions).

## Bekende restpunten (vervolg)

- **OAuth2/OIDC** — codepad aanwezig (`src/oidc.ts`); resteert: IdP-keuze + client-registratie
  bij de afnemer en een integratietest tegen die IdP (issue #16).
- **Secret-management** — file-based secrets ondersteund; resteert: keuze + inrichting van de
  concrete vault/secret-store bij de afnemer (issue #18).
- **Externe pentest** vóór productie (BIO/NIS2-aantoonbaarheid) — externe partij vereist (issue #17).
- Optioneel: IP-allowlist op NPM voor bekende afnemers; `Origin`/DNS-rebinding-check op `/mcp`.
