# Wetsanalyse-workbench + annotatie-agent — plan (gefaseerd)

> **Durable bron van waarheid.** Dit versiebeheerde document is het canonieke plan. Het plan-mode-
> scratchbestand (`~/.claude/plans/…`) is vluchtig en wordt bij een volgende plansessie overschreven —
> dít bestand niet. Bijwerken? Pas dit bestand aan (en commit).
>
> Laatst bijgewerkt: 2026-07-20. Status: Deliverable 0 geleverd (architectuur-artifact + deck);
> Fase 0 in uitvoering.

## Context & visie

Een **wetsanalyse-workbench** in de webapp: een chat-scherm (ChatGPT/Claude-stijl) waarin de jurist de
multi-agent aanspreekt, met **links een documentpaneel** dat opgehaalde artikelen toont. Op de tekst
annoteert de jurist volgens het **Juridisch Analyseschema (JAS, 13 klassen)** op twee manieren:

1. **Handmatig** — fragment selecteren → JAS-klasse + toelichting → onder de tekst groeit een
   **annotatietabel** (klasse · fragment · toelichting · vindplaats). De agent kan als
   **sparringpartner** suggesties geven op een selectie.
2. **Door de agent** — de agent voert zelf een JAS-annotatie uit en biedt **elk element afzonderlijk**
   aan voor een **Human decision: approve / edit / reject / comment**, met per beslissing een
   **"Lessons learned / future improvements"**. **Altijd een append-only audit trail.**

Volledig **geaccordeerde** artikelen promoveren naar de **kennisgraaf** (JAS-annotatielaag).

Uitgangspunten: **vers vanaf de bron** (`docs/wetsanalyse/`, m.n. de 13 JAS-klassen met herken-vragen +
uitdrukkingswijzen) — **niet** de bestaande skill hergebruiken; **conform de huidige agent-architectuur**
(graph-qa multi-agent, SSE, getypeerde tools, grounding, observability); **brongetrouwheid heilig**
(elk element herleidbaar naar bwbId+artikel/lid+tekst-span; agent-voorstellen nooit definitief zonder
mens).

## Architectuurbeslissing (vastgesteld) — 3 lagen + leerlus

- **api = system of record** (hergebruik Postgres, auth/rollen, admin, `/beheer`; de api spreekt al JAS).
  Bewaart annotatie-documenten, human-decisions, **audit trail**, **lessons-learned**, en bezit het
  **enige, geauthenticeerde graaf-schrijfpad** (Fase 4).
- **graph-qa = de annotatie-intelligentie** (nieuwe `annotatie`-specialist + tools; stateless per
  verzoek; streamt voorstellen). Blijft **read-only** op de graaf.
- **frontend = de workbench-UI** (documentpaneel + selectie + annotatietabel + decision-cards). BFF →
  api voor state, → graph-qa voor de agent.
- **Graaf = bestemming**: geaccordeerde annotaties → JAS-annotatielaag in GraphDB.

**Leerlus (kern voor kwaliteit + toekomstvast):** human-decisions (edit/reject/comment + lessons)
worden opgeslagen; de agent haalt via een tool **relevante eerdere beslissingen per JAS-klasse/
werkgebied op als few-shot-context** bij nieuwe voorstellen → betere annotaties naarmate je meer
annoteert, zonder hertrainen. Approved annotaties verrijken de graaf, die de QA-agent én toekomstige
suggesties voedt. **Leer-vóór-je-begint:** vóór het annoteren doet de agent een *pre-flight* — hij haalt
vergelijkbare artikelen + hun eerder gemaakte fouten op, benoemt expliciet waar hij extra op let, en
annoteert dán pas (sterker dan alleen few-shot; ook transparant richting de jurist).

## Review-workflow — de review-ervaring als product

Het onderscheidende zit niet in "nog slimmere AI" maar in een **review-ervaring** die aanvoelt als
GitHub PR's + VS Code + Figma + Copilot: de AI doet een voorstel, de mens beslist — sneller en
consistenter. HITL wordt daarom een **meertraps review-workflow**, niet slechts approve/edit/reject:

`agent-voorstel (met zelfcheck) → Critic-agent → mens → knowledge-check → publiceren`

- **Critic-agent (nieuwe rol in de multi-agent).** Een aparte agent controleert het voorstel vóór de
  jurist het ziet: ontbrekende elementen, verkeerde klasse, inconsistentie, zwakke bron. Scheelt de
  jurist werk en past naadloos in het multi-agent-patroon. (De "self review" vouwen we in de generatie
  i.p.v. als losse stap — een onafhankelijke Critic is sterker dan zelfkritiek.)
- **Knowledge-check.** Consistentie tegen de graaf + bestaande annotaties (werkgebied-brede
  ontdubbeling: homoniemen splitsen, synoniemen samenvoegen) vóór publicatie.
- **Disambiguatie i.p.v. schijnzekerheid.** Bij twijfel geeft de agent **alternatieven met motivatie**
  ("ik twijfel tussen *rechtsgevolg* en *bevoegdheid*, omdat…") zodat de jurist alleen hoeft te kiezen.
  Dit maakt interpretatiekeuzes expliciet — kernwaarde van de methode.
- **Missing-elements.** De agent meldt niet alleen wat hij vond, maar ook **mogelijk ontbrekende**
  elementen (uitzondering, definitie, verwijzing, overgangsrecht) op basis van vergelijkbare artikelen
  + JAS-volledigheid — als *aan te vinken suggesties*, nooit als bewering.
- **Element-diff.** Na een edit een **veld- en tekst-diff** (voor/na per veld, +toegevoegd / −verwijderd /
  ~gewijzigd) — de correctie-delta die de jurist ziet én die de lessons voedt. (Bewust géén "semantische"
  diff overbeloven; een gestructureerde veld/tekst-diff levert de waarde en is haalbaar.)
- **Review-queue + timeline.** Rechts een reviewpaneel per document (statustelling: akkoord / controleren /
  ontbreekt), en de audit als **tijdlijn** (actor · actie · tijd) i.p.v. een platte log.

### Kritische kanttekening — "confidence" met zorg
Rauwe, door het model zelf-gerapporteerde confidence-getallen (0.83…) zijn **slecht gekalibreerd** en
wekken schijnprecisie; blind tonen misleidt de jurist. We houden het triage-doel maar reframen het naar
een **aandacht-niveau** (🟢/🟡/🔴) dat is afgeleid van **concrete signalen**: een Critic-flag, aanwezige
alternatieven, zwakke grounding, of afwijking van eerdere patronen — niet van een losse float. Idem voor
een "kwaliteitsscore": geen enkel ondoorzichtig %-cijfer, maar een **dashboard van concrete indicatoren**
(aantal menselijke wijzigingen, **brondekking**, toegepaste lessons, elementen-per-status).

## Datamodel (api-contracten)

- **AnnotatieElement**: `id`, `klasse` ∈ de 13 JAS-klassen, `tekst` (fragment), `span` [start,end] in de
  artikeltekst, `vindplaats` (bwbId/artikel/lid/jci), `toelichting`, `herkomst` (mens|agent),
  **`lifecycle`** (concept → ai_proposed → critic_checked → human_approved → published → reused),
  **`alternatieven[]`** (kandidaat-klassen + motivatie bij twijfel), **`aandacht`** (🟢/🟡/🔴, *afgeleid*
  van signalen — niet een rauwe modelfloat), `beslissingen[]` (type + actor + tijd + **`review_reason`**
  ∈ {verkeerde_klasse, bron_gemist, tekst, interpretatie, onvoldoende_context, anders} + comment),
  **`diff`** (veld/tekst-delta bij een edit), `lessons[]`.
- **AnnotatieDocument**: groepeert elementen per bron (bwbId+artikel[+lid]) binnen een werkgebied;
  `status` (in-bewerking|geaccordeerd|gepromoveerd); **`mogelijk_ontbrekend[]`** (missing-elements-
  suggesties); draagt de audit trail. Afgeleide **kwaliteits-indicatoren** (menselijke wijzigingen,
  brondekking, toegepaste lessons, elementen-per-status) — géén ondoorzichtig los scorecijfer.
- **AuditRecord** (append-only): elke mutatie/beslissing, onwijzigbaar; render-baar als tijdlijn.
- **Lesson** (gestructureerd): `{pattern, trigger, resolution}` + vrije notitie — machine-opvraagbaar
  per JAS-klasse/trigger door de agent; geaggregeerd in de LessonsStore.

## Fasering

### Deliverable 0 — Architectuur-artifact (HTML) — GELEVERD
De volledige visie + 3-lagen-architectuur + datamodel + flows + fasering als HTML. Repo-kopie:
`docs/wetsanalyse-workbench/architectuur.html`; ook als deelbare Artifact op claude.ai gepubliceerd.
De graph-qa-deck (`tools/graph-qa/agent-presentatie.html`) is aangevuld met de roadmap + review-workflow.

### Fase 0 — Fundament & datamodel (api)
- JAS-klassen-referentie **uit de bron** afleiden (13 klassen: omschrijving, herken-vraag,
  uitdrukkingswijze, kleur uit `wa-table.png`) als gedeelde referentie voor api-validatie én
  agent-prompt.
- api: nieuwe tabellen + Pydantic-contracten (element/document/audit/lessons) + skelet-endpoints
  (CRUD annotatie-document/-elementen, audit read); auth/rollen hergebruikt. **De contracten zijn
  meteen review-klaar**: `lifecycle`, `alternatieven`, `review_reason`, `diff`, gestructureerde
  `Lesson` en `aandacht` zitten er vanaf het begin in (zodat Fase 2 er niet op hoeft te migreren).
  Nog geen agent/UI-logica.
- Tests: contract- + audit-integriteit (append-only) + lifecycle-overgangen.

### Fase 1 — Workbench-UI + handmatige annotatie (frontend + api) — MVP
- Nieuw frontend-scherm: **chatpaneel** (hergebruikt de bestaande QA-agent) + **documentpaneel**
  (artikel ophalen via een tool/endpoint + renderen met selecteerbare tekst) + **selectie → klasse
  (13-kleuren-picker) + toelichting → annotatietabel**; alles persistent via de api met audit.
- BFF-routes voor de annotatie-endpoints. Rijkshuisstijl + JAS-klassekleuren (`docs/wa-table.png`).
- **Legt de review-ervaring-fundamenten**: rechts een **review-queue** (elementenlijst met
  statustelling) en per element een **tijdlijn-audit** — nu nog gevoed door handmatige acties, in
  Fase 2 door de agent. Zo is de UI-taal (queue · statuskleuren · tijdlijn) er al vóór de agent komt.
- Tests: selectie→element→persist→tabel; audit-record per actie.

### Fase 2 — Annotatie-agent + Critic + review-workflow (graph-qa + frontend)
- Nieuwe **`annotatie`-specialist** in `agent/specialists.py`, systeemprompt **uit de JAS-bron**;
  tools: artikel ophalen (hergebruik `get_artikel`/`get_lid`/`get_context`), `stel_annotatie_voor`
  (structureert voorgestelde elementen incl. **alternatieven** bij twijfel), `haal_leerpunten`
  (few-shot + pre-flight uit de LessonsStore), `verwacht_ontbrekend` (missing-elements o.b.v.
  vergelijkbare artikelen).
- **Critic-agent** (tweede rol in de multi-agent): controleert het voorstel (ontbrekend / klasse /
  consistentie / bron) en zet per element het **aandacht-niveau** vóór de jurist het ziet.
- **Review-workflow** in de workbench: de agent streamt voorstellen → de review-queue vult zich met
  decision-cards (approve/edit/reject/comment), elk met **alternatieven-keuze**, **element-diff** bij
  edit, verplichte **`review_reason`**, en een **lesson** die de agent terugvoedt. Beslissingen → api
  (audit-tijdlijn + lessons).
- **Sparringpartner-modus**: op een handmatige selectie de agent om suggesties/klasse/alternatieven vragen.
- **Knowledge-check** vóór "geaccordeerd": consistentie tegen graaf + bestaande annotaties.
- Tests: gescript agent-voorstel → Critic → per-element-beslissing (incl. alternatief-keuze + diff +
  review_reason) → persist + gestructureerde lesson; DI-fakes voor agent én Critic.

### Fase 3 — Diepere JAS (activiteit 3)
- Van markeren (activiteit 2) naar **begrippen + afleidingsregels** (methode-getrouw uit de bron;
  werkgebied-brede ontdubbeling, begrip-id-annotaties). Zelfde HITL + audit.

### Fase 4 — Promoveren naar de graaf (api)
- **JAS-annotatie-vocabulaire** (ontologie) ontwerpen; één **geauthenticeerd schrijfpad** in de api dat
  een volledig geaccordeerd document als triples naar GraphDB schrijft (adresseert het open+writable-
  risico met auth + gecontroleerde mutatie). Idempotent + volledig geaudit. graph-qa's QA-agent kan de
  JAS-laag daarna bevragen (virtuous loop).

Doorlopend: audit trail (vanaf Fase 0), lessons-learned (vanaf Fase 2), observability/trace-koppeling,
DI + tests per laag.

## Kritieke bestanden (indicatief)
- **api**: nieuwe router `app/routers/annotatie.py`, `app/contracts.py` (+element/document/audit/lessons),
  DB-migraties, Fase 4 een GraphDB-write-adapter.
- **graph-qa**: `agent/specialists.py` (annotatie-specialist + Critic), `agent/tools/` (annotatie-/
  lessons-tools), nieuwe prompt uit de JAS-bron.
- **frontend**: nieuw workbench-scherm + componenten (documentpaneel, annotatietabel, decision-card,
  review-queue, tijdlijn) + BFF-routes; JAS-kleuren uit `lib/jas.ts`/`docs/wa-table.png`.

## Verificatie (per fase)
Unit-tests met DI/fakes; een offline/gescript end-to-end pad; live rooktest via de workbench. **Geen
graaf-mutatie vóór Fase 4.** Audit-trail-integriteit en brongetrouwheid (span↔bron) expliciet getest.

## Volgorde van uitvoering
Deliverable 0 (architectuur-artifact) → akkoord → **Fase 0** → Fase 1 (MVP) → beoordelen → Fase 2 → 3 → 4.
Elke fase apart: branch → PR → merge → deploy, conform de huidige werkwijze.
