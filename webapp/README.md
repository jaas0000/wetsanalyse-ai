# Wetsanalyse Webapp

Webapplicatie voor Wetsanalyse volgens de methode van Ausems, Bulles & Lokin
(activiteit 2 + 3). Gebruikers voeren een wetsnaam + artikel in, het systeem
haalt de actuele wettekst op via overheid.nl, classificeert de formuleringen
in JAS-klassen, vormt begrippen en afleidingsregels, en levert een traceerbaar
analyserapport.

## Architectuur

```
webapp/
├── app/
│   ├── main.py              # FastAPI app + routes
│   ├── config.py            # Instellingen
│   ├── models.py            # Pydantic models
│   ├── auth.py              # Gebruikersbeheer + API-key encryptie
│   ├── api/
│   │   ├── analyse.py       # POST /api/analyse, POST /api/review, GET /api/rapport
│   │   └── user.py          # POST /api/user/login, /register, /apikey
│   ├── engine/
│   │   ├── bwb_client.py    # MCP-server client (stdio → JSON-RPC)
│   │   ├── llm.py           # Azure OpenAI integratie (classificatie + betekenis)
│   │   ├── brondefinities.py # Brondefinities-detectie
│   │   ├── rapport.py       # Rapport-generator
│   │   ├── analyse_store.py # SQLite persistente opslag
│   │   └── sru_client.py    # SRU-client (fallback, niet actief gebruikt)
│   ├── prompts/
│   │   ├── jas_klassen.py   # JAS-klassen definities
│   │   ├── activiteit_3.py  # Activiteit 3 vuistregels
│   │   ├── classificatie.py # Systeemprompt activiteit 2
│   │   └── betekenis.py     # Systeemprompt activiteit 3
│   ├── templates/
│   │   ├── index.html       # Hoofdpagina (invoer + review + rapport + historie)
│   │   └── instellingen.html # Instellingenpagina
│   └── static/
│       ├── style.css        # Hoofdstyling
│       └── extra.css        # Extra styles (historie, rapport, tabs)
├── tests/
│   └── test_core.py         # Rapport generatie + analyse store tests
├── Dockerfile               # Multi-stage: Node.js build + Python runtime
├── docker-compose.yml       # Portainer-deploy klaar
└── requirements.txt
```

## Dataflow

1. Gebruiker voert wetsnaam + artikel in
2. MCP-server haalt wettekst op via SRU-API + BWB-repository (overheid.nl)
3. LLM classificeert formuleringen in JAS-klassen (activiteit 2)
4. Gebruiker reviewt de classificaties (checkpoint)
5. LLM vormt begrippen + afleidingsregels (activiteit 3)
6. Gebruiker reviewt de begrippen/regels (checkpoint)
7. Systeem genereert Markdown-rapport
8. Rapport opgeslagen in SQLite, beschikbaar via historie

## Installatie

### Lokaal (ontwikkeling)

```bash
cd webapp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Bouw eerst de MCP-server (in het hoofdproject)
cd ../tools/wettenbank-mcp
npm install
npm run build

# Start de webapp
cd ../../webapp
python -m app.main
```

Open http://localhost:8080

### Docker / Portainer

```bash
cd webapp
docker compose up -d
```

De `docker-compose.yml` bouwt vanuit de projectroot omdat de MCP-server
in `tools/wettenbank-mcp/` staat. De Dockerfile is een multi-stage build:
- Stage 1: bouwt de MCP-server met Node.js
- Stage 2: Python runtime + Node.js binary + gebouwde MCP-server

## Configuratie

### Omgevingsvariabelen

| Variabele | Default | Omschrijving |
|-----------|---------|-------------|
| `WETSANALYSE_SECRET_KEY` | `verander-dit-in-productie` | Encryptie-sleutel voor sessies |
| `WETSANALYSE_DATABASE_PATH` | `data/wetsanalyse.db` | Pad naar SQLite database |
| `WETSANALYSE_AZURE_OPENAI_ENDPOINT` | | Default Azure endpoint (kan per gebruiker) |
| `WETSANALYSE_AZURE_OPENAI_DEPLOYMENT` | `claude-sonnet-4-20250514` | Default deployment |
| `MCP_SERVER_PATH` | automatisch | Pad naar MCP-server dist/index.js |

### Gebruikers

Elke gebruiker geeft zijn eigen Azure OpenAI API-key op via de
instellingenpagina. De key wordt versleuteld opgeslagen (Fernet).

Vereisten per gebruiker:
- Azure OpenAI account met Claude Sonnet 4 (of compatibel model)
- Endpoint URL, API key, en deployment naam

## Productie-checklist

- [ ] `WETSANALYSE_SECRET_KEY` ingesteld op een sterke, unieke waarde
- [ ] `.env` file aangemaakt (kopieer van `.env.example`)
- [ ] MCP-server gebouwd: `cd tools/wettenbank-mcp && npm run build`
- [ ] Docker image gebouwd en getest: `docker compose build`
- [ ] Portainer stack deployed met `docker-compose.yml`
- [ ] Eerste gebruiker aangemaakt via de webinterface
- [ ] Azure API-key geconfigureerd en getest met een bekende wet
- [ ] Responsibiliteit: verifieer dat een analyse een volledig rapport oplevert
- [ ] Backup: `data/wetsanalyse.db` wordt op een volume gemount (zie compose)

## API endpoints

| Method | Path | Omschrijving |
|--------|------|-------------|
| POST | `/api/user/register` | Account aanmaken |
| POST | `/api/user/login` | Inloggen (set cookie) |
| POST | `/api/user/logout` | Uitloggen |
| GET | `/api/user/me` | Huidige gebruiker info |
| POST | `/api/user/apikey` | Azure API-key opslaan |
| POST | `/api/analyse` | Nieuwe analyse starten |
| POST | `/api/review` | Review feedback versturen |
| GET | `/api/analyse/{id}` | Analyse status |
| GET | `/api/analyses` | Lijst van analyses |
| GET | `/api/rapport/{id}` | Rapport ophalen (Markdown) |
| DELETE | `/api/analyse/{id}` | Analyse verwijderen |

## Tests

```bash
cd webapp
source .venv/bin/activate
pip install pytest
python -m pytest tests/ -v
```

## Relatie tot het hoofdproject

Deze webapp staat **naast** het bestaande project als een losse subfolder.
Het hoofdproject (`wetsanalyse-ai`) blijft intact en onaangeroerd. Verwijder
de webapp? Gewoon `rm -rf webapp/`.

De webapp gebruikt:
- De MCP-server als subprocess (via stdio/JSON-RPC) — dezelfde server die
  Claude Code ook gebruikt, ongewijzigd
- De methode-documentatie (JAS-klassen, activiteit 3 vuistregels) als
  LLM-prompts — dezelfde inhoud als in `.claude/skills/wetsanalyse/references/`
- Het analyserapport-sjabloon als output-template — gebaseerd op
  `.claude/skills/wetsanalyse/assets/analyserapport-sjabloon.md`

## Licentie

Zie het hoofdproject voor licentie-informatie.
