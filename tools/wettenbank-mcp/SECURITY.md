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
| `OIDC_AUDIENCE` | — | Verwachte `aud`-claim. **Verplicht** zodra `OIDC_ISSUER` is gezet: zonder audience-controle accepteert de service ook tokens die de IdP voor een ándere service uitgaf (token-confusion); de server weigert dan te starten. |
| `OIDC_JWKS_URI` | via discovery | Expliciet JWKS-endpoint (override). Zonder deze wordt het endpoint via OIDC-discovery bepaald: `${issuer}/.well-known/openid-configuration` → `jwks_uri`. |
| `OIDC_CLIENT_CLAIM` | `azp` | Claim waaruit `clientId` komt; valt terug op `sub`. |
| `MCP_ALLOW_NO_AUTH` | — | `1` = bewust zonder auth starten (alleen achter vertrouwd netwerk). `startHttpServer` is zelf óók fail-closed (`allowNoAuth`-optie). |
| `MCP_ALLOWED_HOSTS` | — | Kommagescheiden allowlist voor de `Host`-header op `/mcp` (DNS-rebinding-bescherming); vreemde Host → 403. Leeg = check uit. Aanbevolen: het publieke domein + de interne containernaam. |
| `MCP_RATE_BURST` | `60` | Max. burst (emmergrootte) per IP. IPv6 wordt per **/64-prefix** gebucket (per-adres limiteren is binnen een /64 gratis te omzeilen); het aantal emmers heeft een hard plafond met LRU-evictie. |
| `MCP_RATE_PER_MIN` | `120` | Aanvulsnelheid per IP per minuut. |
| `MCP_RATE_CLIENT_BURST` | `120` | Max. burst per geauthenticeerde `clientId` (tweede limiter, ná auth — één afnemer achter een gedeeld proxy-IP kan de bron anders alsnog overbelasten). |
| `MCP_RATE_CLIENT_PER_MIN` | `300` | Aanvulsnelheid per `clientId` per minuut. |
| `WETTENBANK_CACHE_MAX_BYTES` | `67108864` | Totaalbudget (bytes rauwe XML) van de wetstekst-cache; LRU-evictie. |
| `MCP_TRUSTED_PROXY_HOPS` | `1` | Aantal vertrouwde reverse-proxies dat zelf een `X-Forwarded-For`-waarde toevoegt (NPM = 1). Bepaalt welk XFF-element als client-IP geldt. |
| `MCP_SESSION_IDLE_MS` | `1800000` | Idle-sessie-opruiming (30 min). |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `LOG_ZOEKTERMEN` | — | `1` = log volledige zoektermen. **Alleen debug** (AVG-risico). |

Tokens horen in een secret-store (Portainer stack-env → bij voorkeur een vault) en worden
**periodiek geroteerd**. Eén client intrekken = zijn `id:token`-paar verwijderen.

## Authenticatie

Per-client bearer-tokens, constant-tijd vergeleken (geen timing-oracle). Elke afnemer heeft een
eigen `clientId` die in de auditlog belandt, zodat aanroepen herleidbaar zijn. `/health` is
bewust auth-vrij (healthcheck Portainer/Azure) en geeft dan alleen `{"status":"ok"}` terug;
de build-info (`version`, `commit`, `builtAt`) gaat **alleen** mee bij een geldige statische
bearer-token — een volledige git-SHA op het publieke domein is fingerprint-informatie.
`/ready` valt, net als `/mcp`, onder de per-IP-rate-limiter (het triggert upstream-checks).
Sessies zijn **gebonden aan de client** die ze initialiseerde: een geldig token van client B
met een (gelekt) sessie-ID van client A krijgt dezelfde 404 als een onbekende sessie, zodat
sessie-overname én vervuiling van de auditlog (acties van B op naam van A) zijn uitgesloten.
TLS wordt door Nginx Proxy Manager getermineerd.

**OAuth2/OIDC (optioneel, dormant tenzij `OIDC_ISSUER` is gezet).** Een binnenkomende
JWT-bearer wordt gevalideerd tegen de IdP: signatuur via JWKS, plus `iss`/`aud`/`exp`/`nbf`.
De `clientId` komt uit `OIDC_CLIENT_CLAIM` (default `azp`, val terug op `sub`). De statische/
file-tokens blijven werken als fallback, zodat migratie geleidelijk kan. Implementatie:
`src/oidc.ts` (met de vetted `jose`-library).

**Secret-management.** Tokens kunnen uit een **bestand** komen (`*_FILE`-env) i.p.v. inline env —
het standaardpatroon voor Docker secrets en vault-agents. Een stack-env is zichtbaar in de
Portainer-UI/API en `docker inspect`; geef daarom de voorkeur aan een gemount tokens-bestand
(zie `docker-compose.yml`, `MCP_AUTH_TOKENS_FILE`). Een token zónder `id:`-prefix logt een
`security`-waarschuwing: dat is meestal een typfout die anders stilzwijgend een anonieme,
werkende token zou opleveren.

**Tokenrotatieprocedure (per client, zonder onderbreking van de rest):**
1. Genereer een nieuwe token (`openssl rand -base64 32`).
2. Voeg het nieuwe paar toe naast het oude: `klant:OUD, klant-nieuw:NIEUW` (of werk het
   tokens-bestand bij) en herdeploy — beide tokens werken nu.
3. Laat de afnemer overschakelen (controleer in de auditlog dat `klant-nieuw` verschijnt).
4. Verwijder het oude paar en herdeploy. Intrekken van één client = alleen zijn paar weghalen.

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
- `test`-job (draait op node 26): `npm test`, een **dist-staleness-check** (gecommitte `dist/`
  moet overeenkomen met `src/`) en `npm audit --audit-level=moderate` (faalt bij moderate of hoger).
- Trivy image-scan: SARIF → GitHub Security-tab; aparte gate faalt bij `CRITICAL`.
- SBOM + provenance als attestatie bij de gepushte image.
- Deploy (Portainer stack-update) gebeurt **op digest** (`WETTENBANK_IMAGE=ghcr.io/...@sha256:...`):
  exact de gebouwde, gescande en geattesteerde image draait — niet "wat `:latest` toevallig is".
  De deploy **verifieert `/health`** na de redeploy en faalt zichtbaar als de container niet
  gezond opkomt; tolereert een gateway-timeout (502/504) op de API-call zelf.
- **Wekelijkse rebuild** (`schedule`): verse base-image-layers en apt-security-patches, ook
  zonder codewijziging.
- `.github/dependabot.yml`: wekelijkse update-PR's (npm, docker, github-actions).
- Runtime-hardening in `docker-compose.yml`: `read_only` root-fs (met `tmpfs` voor `/tmp`),
  `cap_drop: ALL`, `no-new-privileges`, geheugen- en pids-limieten.

## Bekende restpunten (vervolg)

Het codewerk is afgerond; de resterende punten vergen keuzes/acties bij de afnemer:

- **OAuth2/OIDC** — codepad aanwezig en getest (`src/oidc.ts`); resteert de IdP-keuze +
  client-registratie en een integratietest tegen die IdP. Tot die tijd dormant.
- **Secret-management** — file-based secrets (`*_FILE`) ondersteund; resteert de keuze + inrichting
  van de concrete vault/secret-store en een gedocumenteerde rotatieprocedure.
- **Externe pentest** vóór productie (BIO/NIS2-aantoonbaarheid) — vereist een externe partij;
  voorlopig geparkeerd.
- **Dedicated proxynetwerk** — op het gedeelde `homeinfra_internal` kan elke andere container de
  service plaintext op `:3000` bereiken (auth blijft staan, maar tokens reizen daar onversleuteld).
  Aanbevolen: een netwerk met alléén NPM en deze container.
- **Supply-chain-pinning** — GitHub Actions zijn op major-tag gepind (Dependabot houdt ze bij) en
  de base-image op `node:26-slim`; pinning op commit-SHA respectievelijk image-digest is strikter
  maar vergt geverifieerde hashes en is hier (geen registry-toegang vanuit de werkomgeving) als
  vervolgactie geparkeerd.
- Optioneel: IP-allowlist op NPM voor bekende afnemers. De `Host`-check op `/mcp`
  (`MCP_ALLOWED_HOSTS`) staat default uit — aanzetten in de stack-omgeving wordt aanbevolen.
