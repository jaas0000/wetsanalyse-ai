# PR-body-template

`gh pr create` tegen `palmw01/wetsanalyse-ai:master`, head `jaas0000:general-fixes`.

```markdown
## Summary

Sluit <N> open Dependabot-alerts (<X> HIGH, <Y> MEDIUM) op `jaas0000/wetsanalyse-ai` <en beschrijf eventuele extra fixes>.

## Wijzigingen

**Python (api/uv.lock)**
- `<pkg>` <van> → <naar> — <kort: welk CVE / advisory-samenvatting>

**npm — tools/wettenbank-mcp**
- Overrides: `<pkg>` `<van>` → `<naar>` (<advisory-samenvatting>), ...

**npm — tools/wetsanalyse-admin-mcp**
- <idem>

**npm — frontend / frontend-chat**
- <idem>

**Extra fixes** (indien van toepassing)
- <bestand>: <wat en waarom>

## Wat niet in deze PR zit

- <beschrijf expliciet wat je hebt overgeslagen en waarom — voorkomt dat elke
  review-ronde dezelfde vraag komt>
- <bijvoorbeeld: "graph-qa uv builder-refactor uit de superseded 5477034 —
  grotere structurele change, aparte PR waard">

## Test plan

- [x] `<project>`: `<commando>` — <resultaat>
- [x] `<project>`: `<commando>` — <resultaat>
- [ ] Handmatig verifiëren dat GitHub de <N> Dependabot-alerts sluit na merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Titel-conventie

`fix(security): korte-nl-samenvatting`

Voorbeelden uit de repo:
- `fix(security): sluit 18 Dependabot alerts + clipboard unhandled rejection`
- `fix(security): setuptools CVE's + clipboard unhandled rejection + graph-qa uv builder`
- `fix(mcp): npm audit — 5 kwetsbaarheden opgelost (o.a. fast-uri high)`

Onder 70 tekens. NL, actief. Noem het thema, niet de package-lijst
(die staat in de body).

## Commit-message-format (per commit vóór de PR)

Zelfde stijl als de PR-body, maar dan als git-commit — zie
`git log --oneline` in de repo voor voorbeelden. Eindig altijd met:

```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

(of de daadwerkelijke modelnaam die je draait).
