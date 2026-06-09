# Enterprise-plan: logging & beveiliging Wettenbank-MCP

> Status: **voorstel** (nog niet uitgevoerd). Opgesteld 2026-06-09.
> Doelomgeving: **Nederlandse overheid** — BIO2 / NEN-EN-ISO/IEC 27002:2022, AVG en
> (afhankelijk van de afnemer) NIS2 zijn maatgevend.
> Auth-model van keuze: **per-client tokens** (identiteit per afnemer in de auditlog).

Dit document beschrijft hoe de Wettenbank-MCP-server (HTTP-transport, gecontaineriseerde
Portainer-deployment achter Nginx Proxy Manager) geschikt wordt gemaakt voor gebruik in een
overheids-/enterpriseomgeving. Het richt zich op twee sporen: **logging** en **beveiliging**.

De stdio-modus (lokaal subproces) valt buiten scope: die draait op de machine van de gebruiker
zelf en kent geen netwerk-attackoppervlak.

---

## 1. Normenkader (waar moet het aan voldoen?)

### Logging
- **BIO2** (versie jan-2026) neemt de controls van **NEN-EN-ISO/IEC 27002:2022** over. Relevant:
  - **8.15 Logging** — gebeurtenissen registreren; logs beschermen tegen manipulatie.
  - **8.16 Monitoring activities** — afwijkend gedrag kunnen detecteren.
  - **8.17 Clock synchronisation** — UTC/NTP; anders zijn logs forensisch waardeloos.
  - **5.28 Collection of evidence** — forensische bruikbaarheid.
- **NORA "Patroon voor logging"** — scheiding functioneel/audit/security-log; centrale verzameling.
- **NCSC** — *De waarde van loginformatie* + *Handreiking detectie-oplossingen*: log inlogpogingen,
  applicatie-acties en statuswaarschuwingen; bepaal de bewaartermijn **functioneel**.
- **AVG** — geen vaste wettelijke bewaartermijn; doelbinding + dataminimalisatie verplicht. Let op:
  de wéttekst is CC-0, maar de **zoekvraag** ("wie zocht op welk artikel/term") kan afgeleid
  zaakgerelateerde of persoonsgegevens onthullen.
- **NIS2** — indien de afnemer eronder valt: registratieplicht en aantoonbare incidentdetectie.

### Beveiliging
Zelfde BIO2/ISO 27002:2022-set: 5.15–5.18 (toegang), **8.5 secure authentication**,
**8.8 kwetsbaarhedenbeheer**, 8.9 (configuratiebeheer), 8.26 (applicatie-securityeisen),
8.28 (secure coding). Plus NCSC-basisprincipes (TLS, patchen, least privilege).

**Bronnen:**
- BIO – Digitale Overheid: https://www.digitaleoverheid.nl/overzicht-van-alle-onderwerpen/cybersecurity/bio-en-ensia/baseline-informatiebeveiliging-overheid/
- BIO2 v1.3 (PDF, jan-2026): https://www.bio-overheid.nl/media/dr4inbhc/20260109-baseline-informatiebeveiliging-overheid-2-bio2-v13-def.pdf
- NCSC – De waarde van loginformatie: https://www.ncsc.nl/forensics/loginformatie
- NCSC – Handreiking detectie: https://www.ncsc.nl/documenten/publicaties/2019/mei/01/handreiking-voor-implementatie-van-detectie-oplossingen
- NORA – Patroon voor logging: https://www.noraonline.nl/wiki/Patroon_voor_logging
- NIS2 registratieplicht – NCSC: https://www.ncsc.nl/over-ncsc/wettelijke-taak/wat-gaat-de-nis2-richtlijn-betekenen-voor-uw-organisatie/registreren

---

## 2. Huidige staat (gap-analyse)

**Al op orde (sterke basis):**
- Constant-tijd bearer-vergelijking (`http-server.ts:37` `veiligGelijk`).
- Fail-closed zonder token in HTTP-modus (`index.ts:29`).
- 1 MB body-cap (`http-server.ts:30`).
- Idle-sessie-opruiming (`http-server.ts:96`).
- Non-root container + `HEALTHCHECK` (`Dockerfile`).
- TLS-terminatie via NPM; container publiceert geen host-poort (`docker-compose.yml`).
- Sterke Zod-inputvalidatie per tool-handler.

**Logging — groot gat:** de server logt feitelijk niets behalve één startup-`console.error`
(`http-server.ts:192`). Geen request-, auth- of audit-logging. Voldoet niet aan 8.15/8.16,
NORA of NCSC.

**Beveiliging — concrete gaten:**
1. Eén gedeelde statische token voor alle clients → geen identiteit per afnemer, geen rotatie.
2. Geen rate limiting / abuse-bescherming → DoS-risico.
3. Geen secret-management/rotatie (token staat in stack-env).
4. Geen security-scanning in CI (`docker-publish.yml` doet geen `npm audit`/Trivy/SBOM) → botst met 8.8.
5. Geen securityheaders op HTTP-responses.
6. Netwerksegmentatie/IP-allowlisting niet vastgelegd.

---

## 3. Plan — Logging

**Ontwerpprincipe:** gestructureerde JSON-logging (één regel per event) naar **stderr**, zodat de
containerruntime/SIEM het opslaat. De app schrijft géén eigen logbestanden (12-factor + NORA
"centrale verzameling"). Logsoorten gescheiden via een `category`-veld
(`functioneel` | `audit` | `security`). Alleen Node-stdlib — in lijn met het "geen extra
dependency"-principe van dit project.

**Wat loggen (per request):** tijdstip (UTC/ISO-8601), `request_id` + `mcp-session-id`,
client-identiteit (uit het per-client token), bron-IP (uit `X-Forwarded-For`, want achter NPM),
HTTP-methode/pad, tool-naam, BWB-id/artikel, uitkomst (ok/fout + statuscode), latency, body-grootte.
Auth-events apart: elke 401 met reden.

**Wat NOOIT loggen (AVG + secrets):** de bearer-token en de `Authorization`-header, en — belangrijk —
**rauwe `zoekterm`-inhoud niet standaard** (kan onthullen wat een ambtenaar onderzoekt). Default:
alleen lengte/hash of `redacted`-marker; volledige term uitsluitend achter een expliciete debug-flag.

**Stappen:**
1. `src/logger.ts` (stdlib): `log({level, category, ...fields})` → `JSON.stringify` naar stderr.
   Niveaus via `LOG_LEVEL`.
2. Eén `request_id` (`randomUUID`) per inkomende request in `http-server.ts`, meegelust.
3. Logpunten: auth-uitkomst (na `http-server.ts:128`), sessie-lifecycle (init/close/idle-evict),
   per tool-dispatch (in `server.ts`), errors (catch op `http-server.ts:180`).
4. **Clock sync (8.17):** vastleggen dat de container-host NTP-gesynchroniseerd is; UTC-timestamps.
5. **Bewaartermijn (AVG):** voorstel — operationeel 90 dagen, security/audit 6–12 maanden, in SIEM.
   Vastleggen met doelbinding in een `docs/`-notitie.
6. **SIEM-koppeling:** afspraak met afnemer over log-shipping (stdout → platform); app-kant blijft
   vendor-neutrale stdout-JSON.
7. Tests: logger + garantie dat tokens nooit in output lekken.

---

## 4. Plan — Beveiliging (hardening)

**Auth-model: per-client tokens.** `MCP_AUTH_TOKENS` als lijst van `id:token`-paren (constant-tijd
vergelijking blijft). Geeft identiteit in de auditlog en maakt intrekken/roteren per afnemer mogelijk.
`MCP_AUTH_TOKEN` (enkelvoud) blijft als backward-compatibele fallback. Eindbeeld (Fase 3): OAuth2/OIDC
tegen de IdP van de afnemer.

**Prioriteit hoog:**
1. Per-client tokens (zie boven).
2. **Rate limiting** per token/IP (in-memory token-bucket, stdlib) → DoS-bescherming.
3. **Security-scanning in CI** (`docker-publish.yml`): `npm audit --audit-level=high`, **Trivy**
   image-scan, **SBOM** (CycloneDX). Dependabot aanzetten. → control 8.8.

**Prioriteit middel:**
4. **Securityheaders** op alle responses (`X-Content-Type-Options: nosniff`, strikte `Content-Type`,
   geen server-banner).
5. **Secret-management**: token(s) uit Portainer-env naar een vault/secret-store; rotatieprocedure
   documenteren.
6. **Netwerksegmentatie** vastleggen: bevestigen dat alleen NPM de container bereikt; eventueel
   IP-allowlist op NPM voor bekende afnemers.
7. **DNS-rebinding/`Origin`-check** op `/mcp` (opties in de MCP-SDK).

**Borging:**
8. Na implementatie `/security-review` op de diff; bij voorkeur externe pentest vóór productie
   (BIO/NIS2-aantoonbaarheid).
9. `tools/wettenbank-mcp/CLAUDE.md` bijwerken met logging/security-sectie (traceerbaarheid).

---

## 5. Fasering

- **Fase 1 (must-have voor go-live):** logging-laag (§3.1–3.4) + per-client tokens (§4.1) +
  rate limiting (§4.2) + CI-scanning (§4.3). Daarna `/security-review`.
- **Fase 2:** bewaartermijn/SIEM-afspraken (§3.5–3.6) + securityheaders + secret-management (§4.4–4.5).
- **Fase 3:** OAuth2/OIDC-eindbeeld + pentest + documentatie/aantoonbaarheid (§4.7–4.9).

---

## 6. Benodigde skills/agents bij uitvoering

- **`/security-review`** — audit van de diff na elke fase. Dé skill voor dit traject.
- **`/update-config`** — eventuele CI-/permissie-instellingen.
- Geen subagents nodig: de codebase is klein en volledig in kaart gebracht.
