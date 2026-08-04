# PR-body-template

`gh pr create --repo $UPSTREAM_REPO --head $FORK_OWNER:<branch> --base master`.

Zie `fork-sync.md` voor hoe je `UPSTREAM_REPO` en `FORK_OWNER` uit de
git-remotes haalt (geen hardcoded namen in de skill).

```markdown
## Summary

Sluit <N> open Dependabot-alerts (<X> HIGH, <Y> MEDIUM) op de fork <en beschrijf eventuele extra fixes>.

## Wijzigingen

**Python (api/uv.lock)**
- `<pkg>` <van> → <naar> — <kort: welk CVE / advisory-samenvatting>

**npm — tools/<name>-mcp**
- Overrides: `<pkg>` `<van>` → `<naar>` (<advisory-samenvatting>), ...

**npm — frontend / frontend-chat**
- <idem>

**Extra fixes** (indien van toepassing)
- <bestand>: <wat en waarom>

## Wat niet in deze PR zit

- <beschrijf expliciet wat je hebt overgeslagen en waarom — voorkomt dat elke
  review-ronde dezelfde vraag komt>

## Test plan

- [x] `<project>`: `<commando>` — <resultaat>
- [x] `<project>`: `<commando>` — <resultaat>
- [ ] Handmatig verifiëren dat GitHub de <N> Dependabot-alerts sluit na merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Titel-conventie

`fix(security): korte-nl-samenvatting`

Voorbeelden uit `git log --grep=security --oneline`:
- `fix(security): sluit 18 Dependabot alerts + clipboard unhandled rejection`
- `fix(security): setuptools CVE's + clipboard unhandled rejection + graph-qa uv builder`
- `fix(mcp): npm audit — 5 kwetsbaarheden opgelost (o.a. fast-uri high)`

Onder 70 tekens. NL, actief. Noem het thema, niet de package-lijst
(die staat in de body).

## Commit-message-format (per commit vóór de PR)

Zelfde stijl als de PR-body, maar dan als git-commit — zie
`git log --oneline` in de repo voor voorbeelden. Eindig altijd met:

```
Co-Authored-By: Claude <model> <noreply@anthropic.com>
```

Waar `<model>` bv. `Opus 4.7` of `Sonnet 4.6` is — de daadwerkelijke naam
van het model dat de commit produceert.
