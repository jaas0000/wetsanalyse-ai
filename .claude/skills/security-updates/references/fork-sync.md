# Fork-sync — jaas0000/master vs palmw01/master

`jaas0000/wetsanalyse-ai` is een fork van `palmw01/wetsanalyse-ai`. De user
heeft admin op de fork; upstream is de authoritative master.

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

Voor je `gh repo sync --force` doet, tag de echt-unieke commits op origin
zodat ze niet unreachable worden:

```bash
git push origin <sha>:refs/tags/backup/<beschrijvend-naam>
gh repo sync jaas0000/wetsanalyse-ai -b master --force
```

De tags overleven de force-sync en zijn later te cherry-picken:

```bash
git cherry-pick backup/<naam>
# of specifiek bestand:
git checkout backup/<naam> -- pad/naar/bestand
```

## Wanneer NIET syncen

- Als de user tussentijds features op `jaas0000/master` bouwt die niet
  bedoeld zijn voor upstream (zeldzaam voor dit project).
- Als upstream een hard revert heeft die je op de fork wilt overslaan.
- Als er lokale langlopende branches op `origin/master` steunen die je niet
  wilt rebasen. Zeldzaam bij deze workflow (branches steunen op `upstream/
  master`).

Default is: **wel syncen**, meestal na een merge op upstream.
