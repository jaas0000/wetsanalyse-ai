# BWB-importservice op de docker-LXC

Laadt Nederlandse wetgeving (Basiswettenbestand) in de kennisgraaf: haalt de XML op bij
`repository.officiele-overheidspublicaties.nl`, valideert tegen de officiële XSD's, parseert de
structuur en schrijft RDF naar GraphDB (repository `inning`). Per wet **idempotent**.

Verhuisd van de NAS (Portainer-stack 230) na de migratie naar Proxmox.

## Broncode staat elders

De service komt uit de **privérepo `palmw01/n8n`**, map `bwb-import/` — daar staan de Python-code,
de XSD's, de tests en de Dockerfile. Deze map bevat alleen de compose voor de LXC.

Twee verschillen met de NAS-opzet:

1. **Geen n8n-netwerk.** Daar riep een n8n-workflow `http://bwb-import:8000/import` aan; n8n is uit
   het platform gehaald, dus de service hangt alleen nog aan `graphdb_default` en wordt met een
   directe HTTP-call aangestuurd.
2. **Geen `build:`.** Portainer kan bij een string-deploy niet bouwen (geen build-context). Het
   image is op de LXC gebouwd via de Docker build-API.

## Image (opnieuw) bouwen

Nodig na elke codewijziging in `palmw01/n8n`. Vanaf een machine met de broncode:

```bash
cd <checkout>/bwb-import
tar -czf /tmp/ctx.tar.gz --exclude=tests .
curl -sS -X POST -H "X-API-Key: $PORTAINER_API_TOKEN" -H 'Content-Type: application/x-tar' \
  --data-binary @/tmp/ctx.tar.gz \
  "$PORTAINER_URL/api/endpoints/3/docker/build?t=bwb-import:0.1&dockerfile=Dockerfile"
```

Daarna de stack in Portainer opnieuw deployen zodat de container het nieuwe image pakt.

> **Vervolgstap.** Netter is een GitHub Action in `palmw01/n8n` die het image naar GHCR pusht, zoals
> api/frontend/graph-qa hier doen. De compose wordt dan een simpele image-pull en het handmatige
> bouwen vervalt. De oude repo had al een `deploy-bwb.yml` die de NAS-stack herdeployde — die is na
> de verhuizing sowieso stuk (verwijst naar endpoint 1 en stack 230).

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
