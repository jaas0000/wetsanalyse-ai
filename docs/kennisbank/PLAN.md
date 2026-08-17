# Kennisbank — losse documenten naast de wetsgraaf (plan, gefaseerd)

Beheerders uploaden **beleidsstukken en handleidingen**; Lex kan die bevragen **samen met** de
wettekst uit de BWB-kennisgraaf. Vastgesteld met de gebruiker (17 aug 2026): geen persoonsgegevens in
deze documenten, Lex mag wet en interne kennis in één antwoord combineren, en de eerste omvang is
**maximaal ~honderd documenten**.

## Leidend principe — een tweede corpus, dezelfde discipline

Brongetrouwheid is de dragende eigenschap van dit platform en die is concreet geïmplementeerd:
`provenance.iter_refs` herkent vindplaatsen in **tool-resultaten** en `grounding.check_grounding`
verwerpt elk citaat waarvan het BWB-id niet in de trace voorkomt. Bronnen komen nooit uit de
prozatekst van het model.

Een handleiding heeft geen `bwbId`, geen artikel en geen lid. De kennisbank voert daarom een **tweede
referentievorm** in — `document + versie + pagina/sectie + chunk` — die exact dezelfde behandeling
krijgt: uit de tool-trace, letterlijk geciteerd, verifieerbaar. Dit is de kern van het plan; de
vector-opslag eronder is een implementatiedetail.

> **De valkuil om te vermijden:** documenten toelaten zonder de grounding-controle uit te breiden.
> Dan gebeurt één van twee dingen — elk document-antwoord wordt als ongegrond gemarkeerd, of
> document-citaten glippen ongecontroleerd langs de verificatie heen. Het tweede is erger: dan is de
> garantie voor het héle platform zachter geworden zonder dat iemand het ziet.

### Normhiërarchie is geen detail

Wet en beleid zijn niet gelijkwaardig. Een beleidsregel of handleiding legt uit hoe een norm wordt
toegepast; hij verandert de norm niet. In de systeemprompt en in de UI geldt daarom:

1. De **wet is de norm**; beleid en handleidingen zijn **toepassing/uitleg**.
2. Bij **tegenspraak prevaleert de wet**, en Lex benoemt het verschil expliciet in plaats van het
   glad te strijken.
3. Een passage uit een handleiding wordt **nooit** gepresenteerd als de tekst van de wet. De
   bronnenlijst houdt de twee soorten **gescheiden en gelabeld**.
4. Elke document-bron draagt zijn **versie en datum** in beeld. Beleid verjaart, en verouderd beleid
   dat als geldige waarheid terugkomt is de meest waarschijnlijke manier waarop deze functie schade
   doet.

## Beslissingen (met de afweging erbij)

| # | Beslissing | Waarom, en wat het alternatief was |
|---|---|---|
| **D1** | Opslag in de **bestaande PostgreSQL** met **pgvector** (`pgvector/pgvector:pg16` i.p.v. `postgres:16`) | Geen nieuwe stateful container op een LXC met 2 vCPU en 8,6 GB waar al 19 containers draaien; documenten, chunks en vectoren liggen bij de app-state, dus rechten, audit en back-up lopen mee met wat er al is. Een aparte vector-DB (Qdrant/Chroma) is voor dit volume overkill; GraphDB is sterk in relaties maar zwak in documentbeheer (versies, verwijderen, rechten) |
| **D2** | Embeddings via **Azure `text-embedding-3-small`** (1536 dim) op de resource die de LLM al gebruikt | Geen persoonsgegevens, dus geen AVG-beletsel; kosten verwaarloosbaar (~honderd documenten ≈ enkele centen eenmalig). **LocalAI is bewust niet gekozen:** op 2 vCPU wordt elke query-embedding merkbaar traag, het concurreert met GraphDB om RAM, en de vertrouwelijkheidswinst is schijn zolang de generatie zelf via Azure loopt |
| **D3** | **Geen ANN-index** in v1 — exacte cosine-scan (`ORDER BY embedding <=> $1 LIMIT k`) | Bij ~2.000-3.000 chunks is een sequentiële scan sneller én exacter dan HNSW/IVFFlat, die bij kleine sets vooral recall kosten. Groeit het corpus, dan is een HNSW-index één DDL-statement zonder datamigratie |
| **D4** | Retrieval is **hybride**: PostgreSQL-FTS (Dutch) + vector, samengevoegd met reciprocal rank fusion | Spiegelt de bestaande splitsing in de graaf (`search_wetgeving` exact vs. `semantic_search` op betekenis). Exacte termen — een formuliernummer, een regelingnaam — vindt FTS beter; omschrijvingen vindt de vector beter |
| **D5** | De **API bezit de kennisbank**; graph-qa bevraagt hem via HTTP (`GET /v1/kennis/zoek`) | De API heeft de DB, de rechten, de audit en de LLM-config al. graph-qa krijgt géén tweede databaseverbinding; het embedden van de zoekvraag gebeurt in de API, zodat de embedding-configuratie op één plek staat |
| **D6** | **Beheerder uploadt en beheert, elke analist leest** — documenten zijn platform-breed | Nieuw scoping-patroon: annotatie-documenten en gesprekken zijn per gebruiker gescopet, maar dit is juist een gedeeld corpus. Past op de bestaande admin-laag (`/v1/admin/*` + de beheertab) |
| **D7** | v1 leest **PDF met tekstlaag, Markdown en TXT**. Geen OCR, DOCX later | Extractie is waar dit soort functies sneuvelt, niet retrieval: tabellen en kolommen leveren tekst die er goed uitziet maar verschoven is, en dan citeert Lex letterlijk iets wat niet in het document staat. Een scan zonder tekstlaag wordt **geweigerd met uitleg** in plaats van half geïndexeerd |
| **D8** | Een nieuwe upload van hetzelfde document is een **nieuwe versie**; de oude wordt ingetrokken, niet gewist | Antwoorden van gisteren verwijzen naar de vorige versie. Hard verwijderen maakt een eerder citaat onverklaarbaar; intrekken houdt het auditspoor heel en houdt de chunk buiten nieuwe zoekresultaten |

## Datamodel (nieuw, naast de bestaande tabellen)

```
kennis_documenten   id, titel, bestandsnaam, mimetype, versie, datum, geldig_tot?,
                    soort (beleid|handleiding|overig), status (actief|ingetrokken),
                    sha256, paginas, geupload_door, geupload_op, ingetrokken_op?
kennis_chunks       id, document_id, ordinal, tekst, pagina?, kop?, tokens,
                    embedding vector(1536), tsv (generated, Dutch FTS)
kennis_audit        append-only: geupload / opnieuw-geindexeerd / ingetrokken / verwijderd
```

`sha256` maakt een dubbele upload herkenbaar vóór er een cent aan embeddings opgaat. `paginas` en
`pagina` dragen de vindplaats; bij Markdown/TXT neemt `kop` die rol over. De dimensie in het schema
legt het model vast: **een ander embedding-model betekent herindexeren**, en dat hoort een expliciete
beheeractie te zijn (niet iets wat stil scheeft).

## Architectuur — waar wat landt

- **`api/`** — `app/kennis/` (contracts + store + extractie/chunking), `routers/kennis.py`
  (`GET /v1/kennis/zoek`, `GET /v1/kennis/documenten`) en `routers/admin.py` uitgebreid met
  `POST/DELETE /v1/admin/kennis/documenten`. De LLM-laag krijgt naast `complete()` een **`embed()`**
  (LiteLLM `aembedding`) achter dezelfde poort + throttle als de bestaande calls.
- **`tools/graph-qa/`** — één nieuwe getypeerde tool **`zoek_kennis`** in `agent/tools/`, met een
  adapter achter een `KennisPort` (DI, dus faketestbaar zoals `GraphPort`). `provenance.py` en
  `grounding.py` leren de tweede referentievorm. De systeemprompt krijgt de normhiërarchie; de
  specialisten `duiding` en `algemeen` krijgen de tool, `definitie` niet (begrippen komen uit de wet).
- **`frontend/`** — beheertab *Kennisbank* (`components/admin/KennisPanel.tsx`): uploaden, lijst met
  versie/datum/status, intrekken, opnieuw indexeren. In de werkplek: de bronnenlijst onder een antwoord
  splitst in **Wet- en regelgeving** en **Beleid en handleidingen**, met versie en pagina per bron.
- **`deploy/postgres/`** — image naar `pgvector/pgvector:pg16` + `CREATE EXTENSION vector`. De
  bestaande `reconcile_schema()` voegt ontbrekende kolommen additief toe; een **extensie** en een
  `vector`-kolomtype zijn dat niet, dus dit is een bewuste, eenmalige migratiestap met de
  volgorde-afhankelijkheid die de postgres-stack al kent.

## Fasering

### Fase 1 — dun verticaal segment (alle lagen, één formaat, één tool)
Upload (PDF-met-tekstlaag/MD/TXT) → extractie met pagina's → chunking (~500 tokens, overlap,
kop-bewust) → embedding → opslag → `GET /v1/kennis/zoek` (vector-only) → `zoek_kennis` in graph-qa →
grounding uitgebreid → prompt met normhiërarchie → beheertab + gesplitste bronnenlijst.
**Verificatie:** een document-citaat dat niet letterlijk in de chunk staat wordt geweigerd (test);
een gemengde vraag levert beide bronsoorten, gescheiden gelabeld; `eval/golden.jsonl` krijgt
kennis-cases.

### Fase 2 — kwaliteit en beheer
Hybride retrieval (FTS + vector met RRF), DOCX, herindexeren na modelwissel, versiebeheer in de UI,
en een herrank-stap als de treffers te ruis blijken.

### Fase 3 — koppelen aan de graaf
Een document (of chunk) relateren aan een bepaling: *"deze beleidsregel hoort bij art. 36 IW"*. Dan
wordt de kennisbank deel van de kennisgraaf en kan Lex vragen beantwoorden als *"welk beleid hoort bij
dit artikel"*. Dit sluit aan op fase 4 van [het workbench-plan](../wetsanalyse-workbench/PLAN.md)
(promoveren naar de graaf, via één geauthenticeerd en geaudit schrijfpad).

## Risico's

- **Extractie-drift** — verschoven tekst uit tabellen/kolommen leidt tot letterlijke citaten die niet
  in het document staan. Mitigatie: alleen tekstlaag-PDF's, en de chunk bewaart de ruwe tekst zodat een
  citaat altijd tegen de bron te leggen is.
- **Verouderd beleid als waarheid** — mitigatie: `versie`/`datum` verplicht en altijd in beeld,
  `geldig_tot` optioneel, intrekken houdt oude chunks uit nieuwe resultaten.
- **Scope-creep naar documentanalyse** — dit is retrieval over documenten, geen JAS-annotatie van
  documenten. De annotatieketen blijft op de wettekst uit de graaf.
- **Modelwissel** — de vectordimensie staat in het schema; wisselen vraagt herindexeren van het hele
  corpus (bij honderd documenten enkele minuten, verwaarloosbare kosten).
