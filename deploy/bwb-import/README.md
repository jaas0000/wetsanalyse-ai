# BWB-importservice op de docker-LXC

Laadt Nederlandse wetgeving (Basiswettenbestand) in de kennisgraaf: haalt de XML op bij
`repository.officiele-overheidspublicaties.nl`, valideert tegen de officiële XSD's, parseert de
structuur en schrijft RDF naar GraphDB (repository `inning`). Per wet **idempotent**.

Verhuisd van de NAS (Portainer-stack 230) na de migratie naar Proxmox.

## Broncode en image

De broncode staat in **`tools/bwb-import/`** (Python, XSD's, tests). CI bouwt het image naar
`ghcr.io/palmw01/bwb-import` via `.github/workflows/bwb-import-docker-publish.yml`, dat draait bij
een push naar `master` die `tools/bwb-import/**` raakt: eerst de 79 unit-tests, dan build + push +
Trivy-scan. Deze map bevat alleen de compose voor de LXC.

> **Herkomst.** De code stond tot augustus 2026 in de privérepo `palmw01/n8n` en werd door een
> n8n-workflow aangestuurd, met een handmatige Portainer-build. n8n is uit het platform verdwenen;
> de code hoort nu bij de rest van het platform en de uitrol gaat via GHCR.

Twee verschillen met de NAS-opzet:

1. **Geen n8n-netwerk.** Daar riep een n8n-workflow `http://bwb-import:8000/import` aan; nu hangt de
   service alleen aan `graphdb_default` en wordt hij met een directe HTTP-call aangestuurd.
2. **Geen `build:`.** Portainer kan bij een string-deploy niet bouwen; de stack pullt het
   GHCR-image.

## Wekelijkse herimport

De stack draait een cron-container (`bwb-import-cron`) die elke **maandag om 06:00** alle
geconfigureerde regelingen opnieuw importeert — dezelfde cadans als de oude n8n-workflow, die met
n8n verdween zonder vervanging. Zonder die herhaling veroudert de graaf stilzwijgend: een
wetswijziging is dan pas zichtbaar als iemand handmatig importeert, terwijl brongetrouwheid juist de
kernbelofte van het platform is.

De lijst staat expliciet in de stack-env `BWB_IDS` (default: de zeven regelingen die nu in de graaf
zitten) in plaats van "alles wat in de graaf staat" — anders leidt een lege of beschadigde graaf
stilzwijgend tot een lege lijst. De import is per wet idempotent (named-graph `PUT`), dus opnieuw
draaien is veilig en verwijderde artikelen verdwijnen mee.

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

Een batch gaat met `{"bwb_ids": ["BWBR...", "BWBR..."]}`. Zeven regelingen herimporteren duurde
ongeveer 20 seconden.

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

Op de NAS stond `BWB_IMPORT_WTI` op `false`; hier staat het aan.

## Stand (12 aug 2026)

Zeven regelingen in `inning`, 388.161 triples:

| BWB-id | regeling |
|---|---|
| BWBR0002320 | Algemene wet inzake rijksbelastingen |
| BWBR0004766 | Uitvoeringsregeling Invorderingswet 1990 |
| BWBR0004770 | Invorderingswet 1990 |
| BWBR0005537 | Algemene wet bestuursrecht |
| BWBR0018472 | Algemene wet inkomensafhankelijke regelingen |
| BWBR0019237 | Uitvoeringsregeling Algemene wet inkomensafhankelijke regelingen |
| BWBR0024096 | Leidraad Invordering 2008 |
