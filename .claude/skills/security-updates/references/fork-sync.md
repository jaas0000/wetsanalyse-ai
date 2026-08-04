# Fork-sync — fork-master vs upstream-master

Deze skill neemt een fork-workflow aan: de user heeft admin op een fork
(`origin`-remote), en PR's worden gemerged op een authoritative master
(`upstream`-remote). Zie de root-`CLAUDE.md` of het
[[project-wetsanalyse-repo-access]]-memory voor de concrete owners in dit
project — de skill zelf verwijst er niet naar bij naam, want dat maakt 'm
onbestand tegen renames en niet-portabel.

## Fork-remote bepalen

```bash
FORK_REPO=$(git remote get-url origin | sed 's|.*[:/]\([^/]*/[^/]*\)\.git|\1|')
UPSTREAM_REPO=$(git remote get-url upstream | sed 's|.*[:/]\([^/]*/[^/]*\)\.git|\1|')
FORK_OWNER=${FORK_REPO%%/*}
echo "fork=$FORK_REPO  upstream=$UPSTREAM_REPO  fork-owner=$FORK_OWNER"
```

Vervangt hardcoded namen door variabelen; hergebruik ze in `gh`-commando's.

## Divergerende fork detecteren

```bash
git fetch origin upstream --prune
git rev-list --left-right --count origin/master...upstream/master
#   ^left  right — left=uniek op origin, right=uniek op upstream
```

Getallen tellen SHA-verschil, niet content-verschil. Merge-commits van
opzij-mergen PRs op de fork geven vaak "unieke" commits die inhoudelijk al
op upstream/master staan.

## Onderscheiden: echt uniek vs duplicaat op andere SHA

```bash
for sha in $(git log upstream/master..origin/master --format=%H); do
  patch_id=$(git show $sha | git patch-id --stable | awk '{print $1}')
  label=$(git show -s --format='%h %s' $sha)
  found=$(git log upstream/master --format=%H | while read u; do
    up_pid=$(git show $u | git patch-id --stable | awk '{print $1}')
    [ "$up_pid" = "$patch_id" ] && echo "1" && break
  done)
  if [ -n "$found" ]; then
    echo "dup      $label"
  else
    echo "UNIQUE   $label"
  fi
done
```

Alles met `dup` zit al op upstream/master onder een andere SHA (via een
PR-merge). Alleen `UNIQUE`-regels zijn echt werk dat verloren gaat bij een
force-sync.

## Force-sync met backup

Voor je `gh repo sync --force` doet, tag de echt-unieke commits op de fork
zodat ze niet unreachable worden:

```bash
git push origin <sha>:refs/tags/backup/<beschrijvend-naam>
gh repo sync $FORK_REPO -b master --force
```

De tags overleven de force-sync en zijn later te cherry-picken:

```bash
git cherry-pick backup/<naam>
# of specifiek bestand:
git checkout backup/<naam> -- pad/naar/bestand
```

## Wanneer NIET syncen

- Als de user tussentijds features op de fork-master bouwt die niet
  bedoeld zijn voor upstream (zeldzaam voor dit project).
- Als upstream een hard revert heeft die je op de fork wilt overslaan.
- Als er lokale langlopende branches op fork-master steunen die je niet
  wilt rebasen. Zeldzaam bij deze workflow (branches steunen op
  upstream/master).

Default is: **wel syncen**, meestal na een merge op upstream.
