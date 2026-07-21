# Wetsanalyse-workbench + annotatie-agent — plan (gefaseerd)

> **Durable bron van waarheid.** Dit versiebeheerde document is het canonieke plan. Het plan-mode-
> scratchbestand (`~/.claude/plans/…`) is vluchtig en wordt overschreven — dít bestand niet. Bijwerken?
> Pas dit bestand aan (en commit).
>
> Laatst bijgewerkt: 2026-07-20. Status: Deliverable 0 geleverd (architectuur-artifact + deck);
> koers geherijkt (agent-gedreven, vers domein); MVP-bouw volgt.

## Leidend principe

**Alles staat ten dienste van het einddoel: een agent die wetsartikelen volgens het JAS annoteert en de
jurist die reviewt.** De AI produceert, de mens beoordeelt en corrigeert. We klampen ons **niet** vast
aan de huidige opzet (de skill, de analyse-job-pipeline): het annotatie-domein wordt **vers en
toekomstvast** opgebouwd, gericht op die eindtoestand.

Concreet:
- **Agent-gedreven annotatie + menselijke review is het product.** De jurist schrijft in de eindtoestand
  geen annotaties meer from scratch; **handmatig annoteren verdwijnt** als pijler. De enige "handmatige"
  touch die blijft is **corrigeren tijdens de review** (edit). (Een tijdelijk bootstrap-invoerpad mag
  bestaan om de UI/persistentie te testen, maar is expliciet vergankelijk — geen product-doel.)
- **Vers, eigen domein.** Niet op de bestaande analyse-job/skill-contracten (`Markering`, de async
  analyse-flow). Hergebruik alleen **neutrale infra** (auth, Postgres) en **kale data** (de JAS-
  klassenamen als naamlijst, de vindplaats-notatie). De agent-intelligentie komt **volledig vers uit de
  bron** (`docs/wetsanalyse/`, de 13 JAS-klassen met herken-vragen + uitdrukkingswijzen).
- **Brongetrouwheid heilig.** Elk element herleidbaar naar bwbId + artikel/lid + tekst-span; een
  agent-voorstel is nooit definitief zonder menselijke beslissing.
- **Conform de agent-architectuur** (graph-qa multi-agent, SSE, getypeerde tools, grounding,
  observability) — maar de *inhoud* vers.

## Architectuur — 3 lagen + leerlus

- **api = system of record** (hergebruik Postgres, auth/rollen, admin/`/beheer` — puur infra).
  Bewaart annotatie-documenten, human-decisions, **audit trail**, **lessons-learned**, en bezit het
  **enige, geauthenticeerde graaf-schrijfpad** (latere fase). Een **vers annotatie-domein**, los van de
  analyse-contracten.
- **graph-qa = de annotatie-intelligentie** (nieuwe `annotatie`-specialist + Critic; stateless per
  verzoek; streamt voorstellen). Vers uit de bron. Blijft **read-only** op de graaf.
- **frontend = de review-workbench** (documentpaneel + review-queue + decision-cards + tijdlijn). BFF →
  api voor state, → graph-qa voor de agent.
- **Graaf = bestemming**: geaccordeerde annotaties → JAS-annotatielaag in GraphDB (latere fase).

**Leerlus (kern voor kwaliteit + toekomstvast):** human-decisions (edit/reject/comment + lessons)
worden opgeslagen; de agent haalt via een tool **relevante eerdere beslissingen per JAS-klasse/
werkgebied op als few-shot-context**. **Leer-vóór-je-begint:** vóór het annoteren doet de agent een
pre-flight — vergelijkbare artikelen + eerder gemaakte fouten ophalen, benoemen waar hij extra op let,
dán annoteren. Approved annotaties verrijken de graaf, die de agent opnieuw voedt.

## Review-workflow — de review-ervaring als product

Het onderscheidende is een **review-ervaring** als GitHub PR's + VS Code + Figma + Copilot: de AI stelt
voor, de mens beslist — sneller en consistenter. HITL is een **meertraps workflow**:

`agent-voorstel (met zelfcheck) → Critic-agent → mens → knowledge-check → publiceren`

- **Critic-agent (rol in de multi-agent).** Controleert vóór de jurist: ontbrekend, verkeerde klasse,
  inconsistentie, zwakke bron. Zet per element een aandacht-niveau.
- **Disambiguatie i.p.v. schijnzekerheid.** Bij twijfel **alternatieven met motivatie**; de jurist kiest.
- **Missing-elements.** Meldt óók wat waarschijnlijk **ontbreekt** — aan te vinken suggesties.
- **Element-diff.** Na een edit een veld/tekst-diff (+ − ~) — de correctie-delta die de lessons voedt.
- **Review-queue + tijdlijn.** Reviewpaneel met statustelling; audit als leesbare tijdlijn.
- **Knowledge-check** vóór publicatie: consistentie tegen graaf + bestaande annotaties (ontdubbeling).

### Kritische kanttekening — "confidence" met zorg
Géén rauwe model-confidence (slecht gekalibreerd → schijnprecisie). In plaats daarvan een **aandacht-
niveau** (🟢/🟡/🔴) afgeleid van **echte signalen** (Critic-flag, aanwezige alternatieven, zwakke
grounding, patroon-afwijking). Géén ondoorzichtig kwaliteitscijfer → een **dashboard van indicatoren**
(menselijke wijzigingen, brondekking, toegepaste lessons, elementen-per-status).

## Datamodel (vers annotatie-domein)

- **AnnotatieElement**: `id`, `klasse` ∈ de 13 JAS-klassen, `tekst` (fragment), `span` [start,end] in de
  artikeltekst, `vindplaats` (bwbId/artikel/lid/jci), `toelichting`, `herkomst` (agent|mens),
  `lifecycle` (voorgesteld → critic_checked → human_approved → published → reused), `alternatieven[]`
  (kandidaat-klassen + motivatie), `aandacht` (🟢🟡🔴, afgeleid van signalen), `beslissingen[]`
  (type + actor + tijd + `review_reason` + comment), `diff` (veld/tekst-delta bij edit), `lessons[]`.
- **AnnotatieDocument**: elementen per bron (bwbId+artikel[+lid]) binnen een werkgebied; `status`
  (in-review|geaccordeerd|gepromoveerd); `mogelijk_ontbrekend[]`; audit trail; afgeleide
  kwaliteits-indicatoren.
- **AuditRecord** (append-only): elke mutatie/beslissing, onwijzigbaar; render-baar als tijdlijn.
- **Lesson** (gestructureerd): `{pattern, trigger, resolution}` + vrije notitie; opvraagbaar per
  JAS-klasse/trigger.

## Fasering

### Deliverable 0 — Architectuur-artifact (HTML) — GELEVERD
Visie + architectuur + datamodel + review-workflow + fasering, visueel/deelbaar. Repo-kopie
`docs/wetsanalyse-workbench/architectuur-artifact.html` + claude.ai-Artifact; graph-qa-deck aangevuld.

### Fase 1 — MVP: dun agent→review-segment (verticaal, alle 3 lagen)
Het eindtoestand-hart in het klein, end-to-end:
- **api (vers domein):** minimale contracten + tabellen (`AnnotatieDocument`, `AnnotatieElement` met
  `lifecycle`/`beslissingen`, `AuditRecord`) + endpoints (document aanmaken, elementen opslaan,
  beslissing vastleggen, audit lezen); auth/Postgres hergebruikt. Review-klaar ontworpen (velden voor
  latere fasen alvast in het contract). **Geen** koppeling aan de analyse-job-contracten.
- **graph-qa:** nieuwe `annotatie`-specialist, systeemprompt **vers uit de JAS-bron**; tool
  `stel_annotatie_voor` (structureert voorgestelde elementen voor een opgehaald artikel; hergebruikt
  `get_artikel`/`get_lid`/`get_context` voor de tekst). Streamt voorstellen.
- **frontend:** workbench-scherm — documentpaneel (artikel + gemarkeerde spans) + review-queue met
  **decision-cards** (approve/edit/reject/comment) + tijdlijn-audit. BFF → api + → graph-qa.
- **Verificatie:** end-to-end — artikel ophalen → agent stelt voor → per element beslissen → persist +
  audit. DI/fakes + een gescript pad + live rooktest.

### Fase 2 — Volledige review-workflow + leerlus
Critic-agent, disambiguatie (alternatieven), missing-elements, element-diff, aandacht-niveau,
lessons-learned + pre-flight (leerlus), knowledge-check. `review_reason` verplicht bij edit/reject.

### Fase 3 — Diepere JAS (activiteit 3)
Van markeren naar **begrippen + afleidingsregels** (vers uit de bron; werkgebied-brede ontdubbeling).
Zelfde review-workflow + audit.

### Fase 4 — Promoveren naar de graaf
JAS-annotatie-vocabulaire (ontologie); één geauthenticeerd, idempotent, geaudit schrijfpad in de api
(adresseert het open+writable-graaf-risico). Daarna bevraagbaar door de QA-agent (virtuous loop).

Doorlopend: audit trail (vanaf Fase 1), lessons-learned (vanaf Fase 2), observability/trace-koppeling,
DI + tests per laag. **Brongetrouwheid + mens-beslist in elke fase.**

## Kritieke bestanden (indicatief)
- **api**: nieuw `app/annotatie/`-domein (contracts + store + router `app/routers/annotatie.py`), verse
  tabellen in `db.py` (los van `projects`/`rondes`), Fase 4 een GraphDB-write-adapter.
- **graph-qa**: `agent/specialists.py` (annotatie-specialist + Critic), `agent/tools/` (annotatie-/
  lessons-tools), nieuwe prompt vers uit de JAS-bron.
- **frontend**: nieuw workbench-scherm + componenten (documentpaneel, review-queue, decision-card,
  tijdlijn) + BFF-routes; JAS-kleuren uit `docs/wa-table.png`.

## Verificatie (per fase)
Unit-tests met DI/fakes; een gescript end-to-end pad; live rooktest via de workbench. **Geen
graaf-mutatie vóór Fase 4.** Audit-integriteit en brongetrouwheid (span↔bron) expliciet getest.

## Volgorde van uitvoering
Deliverable 0 (AF) → **Fase 1 (MVP agent→review)** → beoordelen → Fase 2 → 3 → 4.
Elke fase apart: branch → PR → merge → deploy, conform de huidige werkwijze.
