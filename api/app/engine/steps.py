"""Begrensde LLM-stappen. Elke stap mergt de brongetrouwe basis (uit de MCP) met de
cognitieve output van het LLM — de basis-velden worden nooit door het LLM verzonnen.
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
    }


def _merge_act2(basis: dict, out: dict) -> dict:
    return {
        **basis,  # brongetrouw: wet, bwbId, artikel, versiedatum, bronreferentie, pad, leden
        "type": out.get("type", ""),
        "analysefocus": out.get("analysefocus", ""),
        "reikwijdte": out.get("reikwijdte", ""),
        "geraadpleegde": out.get("geraadpleegde", ""),
        "markeringen": out.get("markeringen", []),
        "samenhang": out.get("samenhang", ""),
    }


def _merge_act3(basis: dict, out: dict) -> dict:
    return {
        "wet": basis.get("wet", ""),
        "bwbId": basis.get("bwbId", ""),
        "artikel": basis.get("artikel", ""),
        "versiedatum": basis.get("versiedatum", ""),
        "bronreferentie": basis.get("bronreferentie", ""),
        "begrippen": out.get("begrippen", []),
        "afleidingsregels": out.get("afleidingsregels", []),
        "validatiepunten": out.get("validatiepunten", []),
    }


async def genereer_act2(llm: LLMClient, basis: dict, ronde: int, analysefocus: str | None) -> tuple[dict, dict]:
    system, user, schema, phash = prompts.act2_prompt(basis, analysefocus)
    res = await llm.complete(system, user, schema)
    return _merge_act2(basis, res.data), _prov("2", ronde, res, phash, basis)


async def genereer_act3(llm: LLMClient, basis: dict, ronde: int, act2: dict) -> tuple[dict, dict]:
    system, user, schema, phash = prompts.act3_prompt(basis, act2)
    res = await llm.complete(system, user, schema)
    return _merge_act3(basis, res.data), _prov("3", ronde, res, phash, basis)


async def herzie(llm: LLMClient, activiteit: str, basis: dict, ronde: int, vorige: dict, feedback: dict) -> tuple[dict, dict]:
    system, user, schema, phash = prompts.revise_prompt(activiteit, basis, vorige, feedback)
    res = await llm.complete(system, user, schema)
    merge = _merge_act2 if activiteit == "2" else _merge_act3
    return merge(basis, res.data), _prov(activiteit, ronde, res, phash, basis)
