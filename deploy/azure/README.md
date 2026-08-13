# Wetsanalyse op Azure — standby-omgeving

Een **zelfstandige** kopie van het platform op Azure Container Apps: eigen kennisgraaf, eigen
database, geen verbinding met de docker-LXC. Bedoeld om **klaar te staan**, niet om te draaien —
zolang je niets deployt, kost deze map niets.

| Component | Type | Bereikbaar |
|---|---|---|
| PostgreSQL | Flexible Server (B1ms) | intern |
| GraphDB | Container App | intern |
| BWB-import | Container Apps **Job** (handmatig) | — |
| API | Container App | intern |
| graph-qa | Container App | intern |
| Frontend | Container App | **publiek HTTPS** |

Alleen de frontend heeft een publiek adres. De rest praat binnen de Container Apps Environment.

## Vooraf: de GraphDB-licentie

**Zonder licentie is deze omgeving niet bruikbaar.** GraphDB 11 laat zonder licentiebestand alleen
*lezen* toe; het eerste schrijf-verzoek van de import-job krijgt een `500 No license was set`. Op de
docker-LXC zit die licentie in de persistente datadirectory (`/opt/graphdb/home/work/graphdb.license`)
en valt hij niet op — een verse instantie heeft hem niet.

Geef het bestand mee met `--license-file`; het script codeert het naar base64 en zet het als secret
in de deployment, waarna een init-container het op zijn plek schrijft. Controleer eerst of je
licentievoorwaarden een tweede, gelijktijdig draaiende instantie toestaan — dat is een vraag aan
Ontotext, niet aan deze README.

Zonder `--license-file` slaagt de deployment wél; je houdt dan een lege, read-only graaf.

## Deployen

```bash
az login
az group create --name rg-wetsanalyse --location westeurope

# 1. Kijk eerst wat er zou gebeuren (maakt niets aan)
python3 deploy/azure/gen-deploy.py "<azure-ai-key>" \
    --llm-api-base "https://<resource>.services.ai.azure.com" \
    --license-file /pad/naar/graphdb.license \
    --what-if

# 2. Uitrollen (10-15 min; PostgreSQL is de trage stap)
python3 deploy/azure/gen-deploy.py "<azure-ai-key>" \
    --llm-api-base "https://<resource>.services.ai.azure.com" \
    --license-file /pad/naar/graphdb.license \
    --run
```

Daarna twee handelingen:

```bash
# de graaf vullen (~20s voor zeven regelingen)
az containerapp job start -n wetsanalyse-bwb-import -g rg-wetsanalyse

# de eerste beheerder aanmaken
open "<frontendUrl>/setup"     # frontendUrl staat in de deployment-output
```

Het script genereert bij elke run **verse** tokens en wachtwoorden. Op een draaiende omgeving
betekent opnieuw deployen dus dat sessies vervallen en de admin-tokens wijzigen. Voor een omgeving
die je aan- en uitzet is dat prima; wil je ze stabiel houden, bewaar dan het parameterbestand
(`--params-file`) buiten de repo en hergebruik het.

## De graaf is bewust vluchtig

GraphDB draait **zonder persistente opslag**. Dat is geen bezuiniging maar een gevolg van hoe zijn
opslaglaag werkt: geheugen-gemapte bestanden en file-locking verdragen netwerkopslag slecht (traag,
en in het slechtste geval stille indexcorruptie), en Azure Files is de enige persistente mount die
een container-app kan krijgen. Een managed disk zou het oplossen maar vraagt een VM.

Dat kan hier, omdat de graaf **reproduceerbaar** is: de import-job haalt alle regelingen rechtstreeks
bij overheid.nl. Gevolgen:

- De graphdb-app schaalt **niet naar nul** (`minReplicas: 1`) — anders is de graaf bij de volgende
  request leeg. Dit is de component die doorloopt zolang de omgeving aan staat.
- Na elke herstart van die app moet de import-job opnieuw draaien.
- De similarity-index `bwb_similarity` (voor `semantic_search`) overleeft een herstart evenmin en
  moet opnieuw gebouwd worden; tot dat moment valt de tool terug op `search_wetgeving`.

## Beveiliging — hoe dit afwijkt van de LXC

Op de LXC draait GraphDB met eigen security en zit er een auth-proxy voor die het bearer-token van
graph-qa controleert en vervangt door een service-account. **Hier niet**: de graaf is alleen binnen
de Container Apps Environment bereikbaar (`external: false`), en dat is de grens. `GRAPHDB_TOKEN`
wordt wel gezet — de code eist het fail-closed — maar het is hier geen slot.

Voor een standby-/demo-omgeving is dat verdedigbaar. Wordt dit ooit een productieomgeving, dan hoort
hetzelfde service-account + proxy-patroon als op de LXC erbij.

Verder ongewijzigd: alle applicatie-secrets zijn **bestanden** (`*_FILE`-patroon via secret-volumes),
nooit platte env-vars.

## Kosten drukken

- **Uit**: `az group delete -n rg-wetsanalyse` — de omgeving is in een kwartier terug te zetten.
- **Pauze**: `az postgres flexible-server stop -n wetsanalyse-db -g rg-wetsanalyse` plus de
  graphdb-app op nul replica's. Api, graph-qa en frontend schalen zelf terug (frontend houdt één
  replica: een cold start laat Auth.js-redirects timeouten).

## Bestanden

| bestand | wat |
|---|---|
| `main.bicep` | de volledige infrastructuur |
| `gen-deploy.py` | genereert de secrets + parameters en roept `az deployment` aan (`--what-if` / `--run`) |
| `.gitignore` | houdt `params.json` en licentiebestanden buiten de repo |

Het image dat elke app draait is een parameter (`apiImage`, `graphQaImage`, …), zodat CI een digest
kan meegeven in plaats van `:latest`.
