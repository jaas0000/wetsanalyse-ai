# BWB-importservice

Laadt Nederlandse wetgeving (Basiswettenbestand) in de kennisgraaf: haalt de XML op bij
`repository.officiele-overheidspublicaties.nl`, valideert tegen de officiële XSD's, parseert de
structuur en schrijft RDF naar GraphDB (repository `inning`). Per wet **idempotent**.

Draait op de docker-host naast de graaf, op het netwerk `graphdb_default`.

## Broncode en image

De broncode staat in **`tools/bwb-import/`** (Python, XSD's, tests). CI bouwt het image naar
`ghcr.io/palmw01/bwb-import` via `.github/workflows/bwb-import-docker-publish.yml`, dat draait bij
een push naar `master` die `tools/bwb-import/**` raakt: eerst de unit-tests, dan build + push +
Trivy-scan. Deze map bevat alleen de compose voor de docker-host.

De stack heeft bewust **geen `build:`** — Portainer kan bij een string-deploy niet bouwen. De default
`BWB_IMAGE` is het lokaal gebouwde `bwb-import:0.1`; zodra de publish-workflow op master heeft
gedraaid, zet je `BWB_IMAGE=ghcr.io/palmw01/bwb-import:latest` als stack-env.

## Wekelijkse herimport

De stack draait een cron-container (`bwb-import-cron`) die elke **maandag om 06:00** alle
geconfigureerde regelingen opnieuw importeert. Zonder die herhaling veroudert de graaf stilzwijgend:
een wetswijziging is dan pas zichtbaar als iemand handmatig importeert, terwijl brongetrouwheid juist
de kernbelofte van het platform is.

De lijst staat expliciet in de stack-env `BWB_IDS` in plaats van "alles wat in de graaf staat" —
anders leidt een lege of beschadigde graaf stilzwijgend tot een lege lijst. De import is per wet
idempotent (named-graph `PUT`), dus opnieuw draaien is veilig en verwijderde artikelen verdwijnen mee.

Handmatig draaien zonder tot maandag te wachten:

```bash
docker exec bwb-import-cron /usr/local/bin/herimport.sh
```

Het resultaat komt in de containerlogs en dus (via Alloy) in Loki.

## Gebruiken

De service publiceert bewust **geen hostpoort**: importeren is een schrijfactie op de graaf en hoort
niet van buiten aanroepbaar te zijn. Aanroepen dus van binnen het docker-netwerk:

```bash
# één regeling
docker exec bwb-import python3 -c "
import urllib.request as u, json
r = u.urlopen(u.Request('http://127.0.0.1:8000/import', method='POST',
    data=json.dumps({'bwb_id': 'BWBR0004770'}).encode(),
    headers={'Content-Type': 'application/json'}), timeout=3600)
print(json.dumps(json.load(r), indent=2, ensure_ascii=False))"
```

Een batch gaat met `{"bwb_ids": ["BWBR...", "BWBR..."]}`. Zeven regelingen herimporteren duurt
ongeveer 20 seconden.

Schrijven naar de graaf vereist het GraphDB-service-account (`GRAPHDB_SVC_USER`/
`GRAPHDB_SVC_PASSWORD` als stack-env); zie `deploy/graphdb/README.md`.

## Wat er in de graaf komt

Naast de structuur (regeling → hoofdstuk/afdeling → artikel → lid → onderdeel, met relaties en
verwijzingen) levert `BWB_IMPORT_WTI=true` de verrijking uit het WTI-bestand:

| predicaat | inhoud |
|---|---|
| `responsibility_of` / `uitgegevenDoor` / `eerstverantwoordelijke` | verantwoordelijke organisatie |
| `inFamilie` | wetsfamilie (bv. uitvoeringsregeling → moederwet) |
| `heeftGrondslag` / `grondslagVoor` | delegatiegrondslagen |
| `subject` | rechtsgebieden (SKOS-begrippen) |
| `citeertitel` / `afkorting` | officiële titels |
| `type` | o.a. `eli:LegalResource`, `bwb:MinisterieleRegeling` |

## Welke regelingen erin zitten

De zeven regelingen uit `BWB_IDS`, samen ongeveer 388.000 triples:

| BWB-id | regeling |
|---|---|
| BWBR0002320 | Algemene wet inzake rijksbelastingen |
| BWBR0004766 | Uitvoeringsregeling Invorderingswet 1990 |
| BWBR0004770 | Invorderingswet 1990 |
| BWBR0005537 | Algemene wet bestuursrecht |
| BWBR0018472 | Algemene wet inkomensafhankelijke regelingen |
| BWBR0019237 | Uitvoeringsregeling Algemene wet inkomensafhankelijke regelingen |
| BWBR0024096 | Leidraad Invordering 2008 |
