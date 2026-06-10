# Wettenbank MCP-server draaien — beknopte handleiding

Voor wie het kant-en-klare Docker-image `ghcr.io/palmw01/wettenbank-mcp:latest` zelf wil
draaien. Het image is generiek: er zitten **geen tokens, domeinen of klantnamen** in. Al het
omgevingsspecifieke geef je bij het starten mee via environment-variabelen.

De server ontsluit Nederlandse wet- en regelgeving via de publieke SRU-API van overheid.nl.
De data is CC-0; je hebt **geen** API-key voor de bron nodig.

---

## 1. Wat je nodig hebt

- Docker (en eventueel een reverse-proxy met TLS, bijv. Nginx Proxy Manager / Traefik / Caddy).
- Eén of meer **bearer-tokens** die je zelf verzint — clients authenticeren zich daarmee.

---

## 2. Snelst: één container, lokaal testen

```bash
docker run --rm -p 3000:3000 \
  -e MCP_AUTH_TOKENS="test:verzin-hier-een-geheim" \
  ghcr.io/palmw01/wettenbank-mcp:latest
```

Controleer of hij leeft (de healthcheck heeft geen auth nodig):

```bash
curl http://localhost:3000/health
# → {"status":"ok","version":...,"commit":...,"builtAt":...}
```

> **Let op — fail-closed:** in HTTP-modus weigert de server te starten zónder
> `MCP_AUTH_TOKENS` (of de legacy `MCP_AUTH_TOKEN`). Dat voorkomt dat hij per ongeluk open
> online komt. Alleen voor bewust open lokaal gebruik kun je `MCP_ALLOW_NO_AUTH=1` zetten.

---

## 3. Productie: achter een reverse-proxy

De container publiceert in deze opzet géén host-poort; je reverse-proxy regelt TLS en stuurt
door naar poort 3000. Voorbeeld `docker-compose.yml` met **placeholders**:

```yaml
services:
  wettenbank-mcp:
    image: ghcr.io/palmw01/wettenbank-mcp:latest
    container_name: wettenbank-mcp
    restart: unless-stopped
    expose:
      - "3000"
    environment:
      MCP_TRANSPORT: http
      PORT: "3000"
      # Per client een eigen id:token-paar, komma-gescheiden.
      MCP_AUTH_TOKENS: ${MCP_AUTH_TOKENS:?zet id:token,id2:token2 in de omgeving}
    networks:
      - proxy

networks:
  proxy:
    external: true
    name: ${PROXY_NETWORK:-mijn-proxy-netwerk}
```

Voeg in je reverse-proxy een host toe die `https://<jouw-domein>/` doorstuurt naar
`http://wettenbank-mcp:3000`, met TLS (bijv. Let's Encrypt). De proxy moet de
`X-Forwarded-For`-header **zetten** (de rate-limiting leunt erop).

---

## 4. Tokens beheren

`MCP_AUTH_TOKENS` is een komma-gescheiden lijst van `id:token`-paren:

```
MCP_AUTH_TOKENS="belastingdienst:sterk-geheim, analist-jan:ander-geheim"
```

- Elke client krijgt zijn eigen `id` in de auditlog en is los **intrekbaar/roteerbaar**.
- Clients sturen hun token mee als `Authorization: Bearer <token>`.
- Voor Docker secrets / vault: zet de lijst in een bestand en wijs ernaar met
  `MCP_AUTH_TOKENS_FILE`.

---

## 5. Een client (Claude Code) verbinden

In `.mcp.json` van het clientproject — token via env-expansie, zodat hij niet in de repo belandt:

```json
{
  "mcpServers": {
    "wettenbank": {
      "type": "http",
      "url": "https://<jouw-domein>/mcp",
      "headers": { "Authorization": "Bearer ${WETTENBANK_TOKEN}" }
    }
  }
}
```

Zet `WETTENBANK_TOKEN` in je omgeving en controleer met `claude mcp list` → `✓ Connected`.

> Wil je geen server draaien? Dan kan de client de server ook **lokaal als stdio-subproces**
> starten in plaats van via HTTP — zie de README en de `CLAUDE.md` in deze map.

---

## 6. Handige environment-variabelen

| Variabele | Default | Doel |
|---|---|---|
| `MCP_TRANSPORT` | `http` (in image) | `http` of `stdio` |
| `PORT` | `3000` | HTTP-poort |
| `MCP_AUTH_TOKENS` | — (verplicht) | `id:token`-paren, komma-gescheiden |
| `MCP_AUTH_TOKENS_FILE` | — | tokens uit bestand (secrets) |
| `MCP_ALLOW_NO_AUTH` | `0` | `1` = starten zonder auth toestaan (alleen lokaal) |
| `MCP_RATE_BURST` | `60` | rate-limit burst per IP |
| `MCP_RATE_PER_MIN` | `120` | rate-limit per minuut per IP |
| `MCP_TRUSTED_PROXY_HOPS` | `1` | hoeveel proxy-hops in `X-Forwarded-For` te vertrouwen |
| `MCP_SESSION_IDLE_MS` | `1800000` | opruimen van inactieve sessies (30 min) |
| `LOG_LEVEL` | — | drempel voor JSON-logging naar stderr |

Voor de volledige beveiligings- en loggingdetails: zie `SECURITY.md` in deze map.
