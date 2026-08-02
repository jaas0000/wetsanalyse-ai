"""Begrensde LLM-stappen. Elke stap mergt de brongetrouwe basis (uit de MCP) met de
cognitieve output van het LLM — de basis-velden worden nooit door het LLM verzonnen.

Activiteit 2 wordt **per bron** gegenereerd (`genereer_act2_bron`) en in de orchestrator tot
`bronnen[]` geaggregeerd. Activiteit 3 is **werkgebied-breed** en **twee-staps** binnen één
ronde: 3a levert de begrippen, 3b bouwt de regels MET die begrippen als bouwstenen (methode:
eerst een begrip voor wat de regel afleidt, dán de regel).
"""

from __future__ import annotations

from ..llm.base import LLMClient, LLMResult
from . import prompts


def _prov(activiteit: str, ronde: int, res: LLMResult, prompt_hash: str, basis: dict) -> dict:
    return {
        "activiteit": activiteit,
        "ronde": ronde,
        "model": res.model,
        "provider": res.provider,
        "output_strategie": res.output_strategie,
        "referentie_hash": prompts.REFERENTIE_HASH,
        "prompt_hash": prompt_hash,
        "mcp_bwbid": basis.get("bwbId", ""),
        "mcp_versiedatum": basis.get("versiedatum", ""),
        "mcp_bronreferentie": basis.get("bronreferentie", ""),
        "tokens_in": res.tokens_in,
        "tokens_out": res.tokens_out,
        "cache_read_in": res.cache_read_in,
        "cache_write_in": res.cache_write_in,
    }


def _prov_basis(analyse: dict) -> dict:
    """Representatieve mcp-velden voor de provenance van een werkgebied-brede stap (eerste bron)."""
    bronnen = analyse.get("bronnen") or []
    b = bronnen[0] if bronnen else {}
    return {
        "bwbId": b.get("bwbId", ""),
        "versiedatum": b.get("versiedatum", ""),
        "bronreferentie": b.get("bronreferentie", ""),
    }


def _merge_bron(bron_basis: dict, out: dict) -> dict:
    """Bouw één bron-dict: brongetrouwe basis (uit de MCP) + LLM-cognitieve velden. mcp_verwijzingen
    is een interne hulpvariabele en hoort niet in de opgeslagen bron."""
    basis_schoon = {k: v for k, v in bron_basis.items() if k != "mcp_verwijzingen"}
    bid = bron_basis.get("bron_id", "")
    return {
        **basis_schoon,  # bron_id, label, wet, bwbId, artikel, lid, versiedatum, bronreferentie, pad, leden
        "type": out.get("type", ""),
        "reikwijdte": out.get("reikwijdte", ""),
        "geraadpleegde": out.get("geraadpleegde", ""),
        "markeringen": [{**m, "bron_id": bid} for m in out.get("markeringen", [])],
        "verwijzingen": [{**v, "bron_id": bid} for v in out.get("verwijzingen", [])],
        "samenhang": out.get("samenhang", ""),
    }


def _merge_act2_werkgebied(context: dict, out: dict) -> dict:
    """Revise act-2: overlay de LLM-cognitieve velden (markeringen/verwijzingen/samenhang) op de
    brongetrouwe per-bron-basis uit `context` (gematcht op bron_id), zodat het LLM de leden-tekst
    niet kan herschrijven."""
    basis_van = {b.get("bron_id"): b for b in (context.get("bronnen") or [])}
    bronnen = []
    for ob in out.get("bronnen", []):
        bid = ob.get("bron_id", "")
        base = basis_van.get(bid, {})
        bronnen.append({
            "bron_id": bid,
            "label": base.get("label", ""),
            "wet": base.get("wet", ""),
            "bwbId": base.get("bwbId", ""),
            "artikel": base.get("artikel", ""),
            "lid": base.get("lid"),
            "versiedatum": base.get("versiedatum", ""),
            "bronreferentie": base.get("bronreferentie", ""),
            "type": ob.get("type", base.get("type", "")),
            "pad": base.get("pad", ""),
            "leden": base.get("leden", []),
            "reikwijdte": ob.get("reikwijdte", base.get("reikwijdte", "")),
            "geraadpleegde": ob.get("geraadpleegde", base.get("geraadpleegde", "")),
            "markeringen": [{**m, "bron_id": bid} for m in ob.get("markeringen", [])],
            "verwijzingen": [{**v, "bron_id": bid} for v in ob.get("verwijzingen", [])],
            "samenhang": ob.get("samenhang", ""),
        })
    return {
        "werkgebied": context.get("werkgebied", {}),
        "analysefocus": context.get("analysefocus", ""),
        "bronnen": bronnen,
    }


async def inventariseer_verwijzingen(llm: LLMClient, bron_basis: dict) -> LLMResult:
    """Fase 2a (per bron) — lichte LLM-stap die alleen de verwijzing-inventaris (+ `volgen`)
    oplevert. Geeft de volledige LLMResult terug zodat de orchestrator de tokens bij de act-2-ronde
    optelt en de fetch-lus aanstuurt op `res.data`."""
    system, user, schema, _ = prompts.act2_inventaris_prompt(bron_basis)
    return await llm.complete(system, user, schema)


async def genereer_act2_bron(
    llm: LLMClient,
    bron_basis: dict,
    ronde: int,
    analysefocus: str | None,
    inventaris: dict | None = None,
    opgehaald: dict | None = None,
) -> tuple[dict, dict]:
    """Genereer markeringen/verwijzingen voor ÉÉN bron en merge met de brongetrouwe bron-basis."""
    system, user, schema, phash = prompts.act2_prompt(bron_basis, analysefocus, inventaris, opgehaald)
    res = await llm.complete(system, user, schema)
    return _merge_bron(bron_basis, res.data), _prov("2", ronde, res, phash, bron_basis)


async def herzie(
    llm: LLMClient,
    activiteit: str,
    context: dict,
    ronde: int,
    vorige: dict,
    feedback: dict,
) -> tuple[dict, dict]:
    """Herzie activiteit 2 op basis van de review-feedback (sinds act 3 is verwijderd is dit de
    enige herzie-tak)."""
    system, user, schema, phash = prompts.revise_prompt(activiteit, context, vorige, feedback)
    res = await llm.complete(system, user, schema)
    return _merge_act2_werkgebied(context, res.data), _prov("2", ronde, res, phash, _prov_basis(context))
