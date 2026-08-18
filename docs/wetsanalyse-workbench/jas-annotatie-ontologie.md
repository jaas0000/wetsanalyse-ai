# JAS-annotatie-ontologie (GraphDB-annotatielaag)

De **JAS-annotatielaag** legt de geaccordeerde activiteit-2-markeringen van een analyse als RDF vast in
GraphDB, zodat ze herbruikbaar worden voor QA (graph-qa) en volgende analyses — de *virtuous loop*.
Te schrijven door een api-schrijfpad (Fase 2 / WS4, nog niet gebouwd); gelezen door graph-qa's
tool `get_jas_annotaties`. Bewust **minimaal** en losstaand van de begrippen/SKOS-laag (buiten scope).

## Namespace

```
jas: <https://ipalm.nl/ns/jas#>
```

## Named graphs (idempotentie)

Eén **named graph per analyse**: `<JAS_GRAPH_PREFIX><slug>` (default `https://ipalm.nl/jas/<slug>`).
Promoveren = die graaf volledig **vervangen** (`DROP SILENT GRAPH … ; INSERT DATA { GRAPH … { … } }`).
Opnieuw promoveren is dus idempotent: geen dubbele of verweesde annotaties. De annotatie-IRI's zijn
stabiel (`<prefix><slug>/<bron_id>/<markering_id>`), zodat een re-promotie exact dezelfde resources
herschrijft.

## Klassen

| Klasse | Betekenis |
|---|---|
| `jas:AnnotatieLaag` | De graaf-resource per analyse (draagt `jas:uitAnalyse` + `jas:gepromoveerdOp`). |
| `jas:Annotatie` | Eén geaccordeerde act-2-markering. |

## Eigenschappen van `jas:Annotatie`

| Predicaat | Object | Verplicht | Toelichting |
|---|---|---|---|
| `jas:klasse` | literal | ✓ | Eén van de dertien JAS-klassen. |
| `jas:formulering` | literal | ✓ | Het letterlijke citaat uit de leden-tekst (brongetrouw). |
| `jas:markeringId` | literal | ✓ | Stabiel id binnen de analyse (`m1`, …). |
| `jas:uitAnalyse` | literal (slug) | ✓ | Herkomst: de analyse die deze annotatie accordeerde. |
| `jas:bwbId` | literal | ✓ | Regeling-id — herleidbaarheid, ook bij decimale artikelnummers. |
| `jas:artikel` | literal | ✓ | Artikelnummer (bv. `9` of `9.1`). |
| `jas:lid` | literal | — | Lidnummer indien van toepassing. |
| `jas:vindplaats` | literal | — | Lid-relatieve vindplaats (bv. `lid 2`). |
| `jas:overBepaling` | IRI | — | Koppeling naar de **bestaande** bepaling-node (`…/artikel/<n>[/lid/<n>]`); alleen bij een kaal (IRI-patroon-)nummer. |
| `jas:toelichting` | literal | — | Motivatie van de classificatie. |
| `jas:twijfel` | literal | — | Expliciete twijfel/aanname bij de markering. |

> **Herkomst is inmiddels beschikbaar.** Het annotatiedomein legt sinds de export-slag per element
> vast met welk model het voorstel is gemaakt (`geproduceerd_door`: model/provider/agent_versie/
> critic_rondes) en per document het volledige `runs[]`-spoor. Bij het bouwen van dit schrijfpad
> (Fase 4) hoort die provenance mee te gaan — de tabel hierboven kent er nog geen predicaten voor.
> De JSON-export (`POST /v1/annotatie/documenten/{slug}/export?formaat=json`) is de superset waaruit
> die mapping te maken is.

## Voorbeeld

```turtle
GRAPH <https://ipalm.nl/jas/iab-zorgverzekeringswet> {
  <https://ipalm.nl/jas/iab-zorgverzekeringswet> a jas:AnnotatieLaag ;
    jas:uitAnalyse "iab-zorgverzekeringswet" ; jas:gepromoveerdOp "2026-08-05T…Z" .

  <https://ipalm.nl/jas/iab-zorgverzekeringswet/br1/m1> a jas:Annotatie ;
    jas:klasse "Rechtssubject" ;
    jas:formulering "De verzekeringsplichtige" ;
    jas:markeringId "m1" ; jas:uitAnalyse "iab-zorgverzekeringswet" ;
    jas:bwbId "BWBR0018450" ; jas:artikel "43" ; jas:lid "2" ;
    jas:vindplaats "lid 2" ;
    jas:overBepaling <https://ipalm.nl/bwb/BWBR0018450/artikel/43/lid/2> .
}
```

## Herleidbaarheid & QA (virtuous loop)

`jas:overBepaling` verbindt de annotatie met dezelfde bepaling-node die graph-qa al leest, dus de
JAS-duiding verschijnt náást de wettekst. graph-qa's read-tool `get_jas_annotaties(bwbId, artikel, lid?)`
zoekt over de named graphs op de `jas:bwbId`/`jas:artikel`(/`jas:lid`)-literals (robuust, ook voor
decimale nummers) en levert per treffer klasse/formulering/vindplaats + de bron-analyse (`jas:uitAnalyse`).

## Buiten scope

Begrippen (activiteit 3) en SKOS-concepten worden **niet** door dit schrijfpad geschreven; die laag
wordt later op een agentische basis herbouwd. Het schrijf-token (`GRAPHDB_WRITE_TOKEN`) is apart van het
lees-token (least privilege).
