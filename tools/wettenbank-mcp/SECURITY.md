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
| `MCP_AUTH_TOKENS` | — | Per-client tokens: `"belastingdienst:abc, analist-jan:def"`. **Aanbevolen.** Een token zónder `id:`-prefix wordt geaccepteerd als clientId `default` (backward-compat). |
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
| `MCP_TRUSTED_PROXY_HOPS` | `1` | Aantal vertrouwde reverse-proxies dat zelf een `X-Forwarded-For`-waarde toevoegt (NPM = 1). Bepaalt welk XFF-element als client-IP geldt. |
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
`src/oidc.ts` (met de vetted `jose`-library).

**Secret-management.** Tokens kunnen uit een **bestand** komen (`*_FILE`-env) i.p.v. inline env —
het standaardpatroon voor Docker secrets en vault-agents. Rotatie: vervang een `id:token`-paar
(of het secret-bestand) en herdeploy; per-client intrekken raakt de andere clients niet.

## Invoer- en uitvoerhardening

- **Client-IP / X-Forwarded-For (anti-spoofing).** De rate-limit-key en het audit-IP worden
  afgeleid uit `X-Forwarded-For` via de **N-de waarde van rechts** (`MCP_TRUSTED_PROXY_HOPS`,
  default 1), niet de eerste van links. Zo kan een door de client zélf meegestuurde XFF de
  rate-limiting niet omzeilen of het audit-IP vervalsen. Voorwaarde: de reverse-proxy moet XFF
  **zetten/append**en (NPM doet dit); zet `MCP_TRUSTED_PROXY_HOPS` gelijk aan het aantal
  vertrouwde proxies vóór de container. Code: `kiesClientIp` in `src/http-server.ts`.
- **SSRF-mitigatie op de wetstekst-fetch.** De repository-URL komt uit de SRU-respons
  (`overheidbwb:locatie_toestand`) en is dus door de bron bepaald. `parseRecords` accepteert die
  alleen als hij `https:` naar `repository.officiele-overheidspublicaties.nl` wijst
  (`isVertrouwdeRepoUrl`); anders een zelf-geconstrueerde URL met die vaste host. `haalWetstekstOp`
  weigert defensief elke niet-vertrouwde URL vóór de `fetch`. Code: `src/clients/sru-client.ts`,
  `src/clients/repository-client.ts`. Het `bwbId` wordt op formaat (`^BWBR\d+$`) gevalideerd
  (`src/shared/schemas.ts`), zodat het geen CQL-query of URL-pad kan manipuleren.
- **Geen interne foutdetails naar de client.** Het HTTP-transport stuurt bij een onverwachte fout
  een generieke melding; de volledige fouttekst (upstream-status, timeout) blijft in de
  stderr-log (`src/http-server.ts`).

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
- `test`-job (draait op node 26): `npm test` + `npm audit --audit-level=moderate` (faalt bij moderate of hoger).
- Trivy image-scan: SARIF → GitHub Security-tab; aparte gate faalt bij `CRITICAL`.
- SBOM + provenance als attestatie bij de gepushte image.
- Deploy (Portainer stack-update) **verifieert `/health`** na de redeploy en faalt zichtbaar als de
  container niet gezond opkomt; tolereert een gateway-timeout (502/504) op de API-call zelf.
- `.github/dependabot.yml`: wekelijkse update-PR's (npm, docker, github-actions).

## Bekende restpunten (vervolg)

Het codewerk is afgerond; de resterende punten vergen keuzes/acties bij de afnemer:

- **OAuth2/OIDC** — codepad aanwezig en getest (`src/oidc.ts`); resteert de IdP-keuze +
  client-registratie en een integratietest tegen die IdP. Tot die tijd dormant.
- **Secret-management** — file-based secrets (`*_FILE`) ondersteund; resteert de keuze + inrichting
  van de concrete vault/secret-store en een gedocumenteerde rotatieprocedure.
- **Externe pentest** vóór productie (BIO/NIS2-aantoonbaarheid) — vereist een externe partij;
  voorlopig geparkeerd.
- Optioneel: IP-allowlist op NPM voor bekende afnemers; `Origin`/DNS-rebinding-check op `/mcp`.
