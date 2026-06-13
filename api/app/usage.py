"""Token-verbruik-aggregatie over de `provenance` van alle projecten.

Read-only: er is geen aparte tracking-laag nodig. Elke `Project.provenance[]` bevat per ronde
het feitelijk gebruikte model/provider en `tokens_in`/`tokens_out` (zie contracts.RondeProvenance),
gevuld vanuit het LLMResult in engine/steps. We aggregeren dat met één Mongo-pipeline.
"""

from __future__ import annotations

from .project import Project

# Toegestane groepeer-sleutels → het veld waarop gegroepeerd wordt. `model`/`provider` zitten op
# de provenance-ronde; `model_profile`/`client_id` op het project-document.
_GROUP_VELDEN = {
    "model": "$provenance.model",
    "provider": "$provenance.provider",
    "model_profile": "$model_profile",
    "client_id": "$client_id",
}


async def usage_report(
    group_by: str = "model", van: str | None = None, tot: str | None = None
) -> dict:
    """Geef het verbruik gegroepeerd op `group_by`, plus een grand total.

    `van`/`tot` filteren (inclusief/exclusief) op `provenance.tijdstip` (ISO-string, lexicografisch
    vergelijkbaar). Geeft `{"group_by", "rows": [...], "totaal": {...}}`.
    """
    if group_by not in _GROUP_VELDEN:
        raise ValueError(f"Onbekende group_by: {group_by!r} (kies uit {sorted(_GROUP_VELDEN)})")

    pipeline: list[dict] = [{"$unwind": "$provenance"}]
    tijd_match: dict = {}
    if van:
        tijd_match["$gte"] = van
    if tot:
        tijd_match["$lt"] = tot
    if tijd_match:
        pipeline.append({"$match": {"provenance.tijdstip": tijd_match}})

    pipeline += [
        {
            "$group": {
                "_id": _GROUP_VELDEN[group_by],
                "tokens_in": {"$sum": "$provenance.tokens_in"},
                "tokens_out": {"$sum": "$provenance.tokens_out"},
                "rondes": {"$sum": 1},
                "analyses": {"$addToSet": "$_id"},
            }
        },
        {
            "$project": {
                "_id": 0,
                "sleutel": {"$ifNull": ["$_id", ""]},
                "tokens_in": 1,
                "tokens_out": 1,
                "rondes": 1,
                "analyses": {"$size": "$analyses"},
            }
        },
        {"$sort": {"tokens_in": -1}},
    ]

    rows = await Project.aggregate(pipeline).to_list()
    totaal = {
        "tokens_in": sum(r["tokens_in"] for r in rows),
        "tokens_out": sum(r["tokens_out"] for r in rows),
        "rondes": sum(r["rondes"] for r in rows),
        "analyses": sum(r["analyses"] for r in rows),
    }
    return {"group_by": group_by, "rows": rows, "totaal": totaal}


async def usage_per_profiel() -> dict[str, dict]:
    """Verbruik gegroepeerd op `model_profile` als map name → totalen (voor de profielenlijst)."""
    rapport = await usage_report(group_by="model_profile")
    return {r["sleutel"]: r for r in rapport["rows"] if r["sleutel"]}
