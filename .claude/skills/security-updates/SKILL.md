---
name: security-updates
description: >-
  Verwerkt open Dependabot- en code-scanning-alerts gestructureerd: alerts
  ophalen bij de git-remote waar Dependabot draait, groeperen per risico
  (mechanische patch/minor vs semver-major met breaking changes), de juiste
  bump per ecosystem toepassen (npm-overrides, uv-lock, docker-base, github-
  actions-pin), verifiëren met de projectspecifieke testsuite, committen met
  het `fix(security):`-formaat, PR openen tegen de authoritative master, en
  superseded Dependabot-PR's netjes closen. Gebruik deze skill zodra de
  gebruiker security-updates, kwetsbaarheden, Dependabot-alerts of CVE's
  wil verwerken — ook bij vragen als "los de dep-vulns op", "bump alle
  security-alerts", "wat staat er open in Dependabot", "kunnen we de HIGH's
  fixen". Trigger óók bij twijfel: dit is de aangewezen werkwijze voor
  security-work in dit project. Werkt guided, niet volautomatisch — bij een
  semver-major die code-migratie vergt (zoals mcp v2) stopt de skill voor
  akkoord.
---

# Security-updates (Dependabot + code-scanning)

## Wat dit is en waarom het zo werkt

Deze skill verwerkt open vuln-alerts systematisch in plaats van ad hoc. Alerts
komen uit verschillende feeds (Dependabot, Trivy in CI, npm audit) en raken
verschillende manifests (npm `package.json`/`overrides`, `uv.lock`, Dockerfile-
base-image-pin, `.github/workflows/*.yml` SHA-pins). Zonder discipline mis je
alerts, bump je in het verkeerde bestand, of merge je een PR die stil de build
breekt.

De skill is **guided, niet volautomatisch**. Mechanische patch/minor bumps
loopt hij in één ronde af; semver-majors of alerts die code-migratie vergen
(zoals de mcp v2-migratie) stopt hij vóór de commit voor akkoord van de
gebruiker.

Twee harde invarianten:

- **Alerts bevraag je op de remote waar Dependabot draait.** In een
  fork-workflow is dat vaak niet de authoritative master. Zie
  `references/fork-sync.md` voor hoe je de juiste remote bepaalt — check
  altijd het [[project-wetsanalyse-repo-access]]-memory voor de actuele
  eigenaars-split in dit project.
- **Nooit committen met falende tests.** De verificatie-mix per project
  (build + audit + testsuite) is een harde blok, geen suggestie. Zie
  `references/verificatie-checklist.md`.

## Terminologie

Overal in deze skill gebruikt:

- **`fork-remote`** — de git-remote van de fork waar de user admin heeft;
  daar draait Dependabot en daar staan de branches/PR's. Meestal `origin`.
- **`upstream-remote`** — de git-remote van de authoritative master; daar
  worden PR's op gemerged. Meestal `upstream`.

Bepaal ze via:

```bash
git remote get-url origin      # fork
git remote get-url upstream    # authoritative
```

Zet ze bovenaan je shell-sessie:

```bash
FORK_REPO=$(git remote get-url origin   | sed 's|.*[:/]\([^/]*/[^/]*\)\.git|\1|')
UPSTREAM_REPO=$(git remote get-url upstream | sed 's|.*[:/]\([^/]*/[^/]*\)\.git|\1|')
```

Verifieer met `echo $FORK_REPO $UPSTREAM_REPO` — verwacht `<owner>/<repo>`
voor beide, met verschillende owners.

## Werkstroom

### Stap 0 — Startvoorwaarden

Werk vanuit een branch die op `upstream/master` is gebaseerd (niet de
fork-master — die kan achterlopen). Standaardnaam varieert per taak; voor
Dependabot-verwerking is `general-fixes` de plek van keuze:

```bash
git fetch origin upstream --prune
git checkout general-fixes
git rebase upstream/master            # backup-tag eerst als de branch commits heeft
```

De projectroot is de repo-root; blijf daar staan i.v.m. eventuele write-guards
(zie root-`CLAUDE.md`).

### Stap 1 — Alerts ophalen en groeperen

```bash
gh api repos/$FORK_REPO/dependabot/alerts?state=open --paginate
gh api repos/$UPSTREAM_REPO/code-scanning/alerts?state=open --paginate
```

Als de fork-remote geen Dependabot-alerts toont (403 / "disabled for this
repository"), vraag de user of ze het aanzetten — nooit stil doorwerken
zonder alerts. Zie [[feedback-vraag-bij-ontbrekende-toegang]].

De **code-scanning-alerts** overlappen vaak met Dependabot (Trivy scant
dezelfde `.venv`/dep-tree). Alleen alerts die *niet* al door een Dependabot-fix
worden gedekt tellen als apart werk.

Groepeer per (ecosystem, package, ernst). Zie
`references/ecosystems.md` voor waar elke package geraakt wordt.

### Stap 2 — Risico-triage

Voor elke unieke bump:

- **Patch/minor bump binnen dezelfde major** → *mechanisch*. Bump kan zonder
  tussenkomst mits tests groen zijn.
- **Semver-major** of **advisory noemt breaking changes/migration** → *risico*.
  Skill toont de changelog/upgrade-guide-samenvatting en wacht op akkoord
  vóór de bump.
- **Groep-PR met meerdere majors verpakt** (bv. Dependabot's dev-dep-groep
  die eslint + tailwind + typescript in één keer een major bumpt) → *risico*
  ongeacht dev-only-status; behandel per package.
- **Alert alleen in `.venv/` / installed-image, manifest is al ok** → *skip
  met notitie*. De volgende CI-image-build sluit 'm vanzelf (bv. msgpack/
  setuptools met een `>=`-pin die al voldoet).
- **Alert op een transitive dep zonder directe manifest-hit** → gebruik
  `overrides` (npm) of forceer via `uv lock --upgrade-package` (uv). Zie
  `references/ecosystems.md`.

Meld alle risico-groep-items in één keer aan de gebruiker en vraag akkoord
vóór je verder gaat.

### Stap 3 — Bumps toepassen

Één ecosystem per keer. Volgorde: klein → groot (npm-tools → frontends → api
→ Dockerfiles → github-actions). Details in `references/ecosystems.md`.

Na elk gebumpt project: **direct verifiëren** (stap 4) — pas als groen door
naar de volgende. Verifieer nooit alles tegelijk aan het einde: één breuk is
dan onduidelijk toe te schrijven.

### Stap 4 — Verifiëren

Draai de volledige check-mix per gewijzigd project — zie
`references/verificatie-checklist.md`. Faalt iets, dan **niet forceren**:
diagnose eerst. Een falende testsuite ná een bump is meestal ofwel een echte
breaking change (rol terug of migreer) of een fixture die de nieuwe API
verwacht.

### Stap 5 — Committen

Eén commit voor de mechanische groep, aparte commits voor elke risico-bump
die code-changes meebracht. Formaat volgt de conventie in de repo
(zie `git log --grep=security` voor recente voorbeelden):

```
fix(security): korte samenvatting

Bumps voor de open Dependabot alerts op de fork:

- <manifest>: <pkg> <van> -> <naar> (<severity>: <CVE-summary>)
- ...

Ook <eventuele extra fixes uit hetzelfde thema>.

Getest: <projecten die getest zijn> — <resultaat>.

Co-Authored-By: Claude <model> <noreply@anthropic.com>
```

Nederlands, actief, geen marketing-taal. CVE's noemen waar relevant. **Nooit
`.env`/secrets/lokale-config-dirs** stagen — controleer `git status` na
`git add` en gebruik expliciete paden i.p.v. `git add -A`.

### Stap 6 — Pushen + PR

```bash
git push --force-with-lease origin general-fixes         # nooit --force zonder lease
FORK_OWNER=${FORK_REPO%%/*}
gh pr create --repo $UPSTREAM_REPO \
  --head $FORK_OWNER:general-fixes --base master \
  --title "..." --body "..."
```

Body volgt het formaat in `references/pr-template.md`.

Als deze push een bestaande commit op de fork-branch overschrijft
(force-push), maak dan **eerst** een backup-tag:
`git push origin <oude-sha>:refs/tags/backup/<naam>`.

### Stap 7 — Superseded Dependabot-PR's closen

Als een handmatige bump een openstaande Dependabot-PR vervangt (bv. omdat je
de bump combineerde met een code-migratie of via overrides breder oploste),
close 'm met een comment die naar de handmatige commit verwijst:

```bash
gh pr close <nr> --repo $FORK_REPO -c "Vervangen door <sha> (<korte reden>)."
```

### Stap 8 — Fork-master syncen (optioneel)

Na merge van de PR op upstream/master:

```bash
gh repo sync $FORK_REPO -b master
```

Divergeert de fork-master? Zoek eerst met patch-id welke commits echt
uniek zijn (zie `references/fork-sync.md`); tag ze desnoods als backup vóór
een `--force`-sync.

## Escape hatches

- **Advisory noemt actieve exploits / CRITICAL / RCE** → stop de reguliere
  batch, isoleer die bump in een eigen PR, escaleer aan de gebruiker.
- **Testsuite is stuk vóór jouw bump** → niet jouw probleem om te fixen, maar
  meld het; anders blokkeert het je verificatie-stap.
- **Bump vraagt een `.venv`-rebuild in een Docker-image** → de Dockerfile-
  pin/lock is het manifest, niet het `.venv` in de bestaande image. De alert
  sluit bij de volgende image-build.
- **De user zegt "sla over"** → sla over, log de reden in de PR-body zodat
  het niet elke week opnieuw op tafel komt.

## Wat deze skill NIET is

- Geen vervanging voor code-review op de bump zelf — je leest de release-
  notes van elke risico-bump.
- Geen algemene "dep-refresh" — alleen alerts. Voor gewone version-updates
  is `.github/dependabot.yml` verantwoordelijk.
- Niet voor GHAS/CodeQL-alerts (die vragen code-fixes, niet bumps). Als een
  code-scanning-alert een échte bug is, behandel 'm apart.
