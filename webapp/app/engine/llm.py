"""LLM-engine voor de wetsanalyse webapp.

Communiceert met Azure OpenAI of OpenRouter om:
- Activiteit 2: JAS-classificatie van wetsformuleringen
- Activiteit 3: Begrippen en afleidingsregels vormen

Gebruikers geven hun eigen API-key op en kiezen hun provider.
"""

import asyncio
import json
import logging

import httpx

from app.models import (
    Activiteit2Data,
    Activiteit3Data,
    Afleidingsregel,
    Begrip,
    LidData,
    Markering,
)
from app.prompts.jas_klassen import JAS_KLASSEN
from app.prompts.activiteit_3 import ACTIVITEIT_3_VUISTREGELS
from app.prompts.classificatie import CLASSIFICATIE_SYSTEM_PROMPT
from app.prompts.betekenis import BETEKENIS_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


class LlmError(Exception):
    """Fout bij LLM-communicatie."""


def _build_url(provider: str, endpoint: str, model: str, api_version: str = "2024-06-01") -> str:
    """Bouw de chat completions URL op basis van provider."""
    base = endpoint.rstrip("/")

    if provider == "azure":
        # Azure OpenAI: /openai/deployments/{deployment}/chat/completions
        return f"{base}/openai/deployments/{model}/chat/completions?api-version={api_version}"
    else:
        # OpenRouter (en compatible): /chat/completions
        # endpoint = base URL, model = model identifier in body
        return f"{base}/chat/completions"


def _build_headers(provider: str, api_key: str) -> dict[str, str]:
    """Bouw request headers op basis van provider."""
    headers = {"Content-Type": "application/json"}

    if provider == "azure":
        headers["api-key"] = api_key
    else:
        # OpenRouter en andere OpenAI-compatible providers
        headers["Authorization"] = f"Bearer {api_key}"

    return headers


async def _call_llm(
    provider: str,
    endpoint: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 4096,
    max_retries: int = 3,
    api_version: str = "2024-06-01",
) -> dict:
    """Roep de LLM aan en retourneer het geparseerde JSON-antwoord.

    Ondersteunt Azure OpenAI en OpenRouter (en andere OpenAI-compatible APIs).
    Retry bij transient errors (429, 502, 503, 504) met exponential backoff.
    """
    url = _build_url(provider, endpoint, model, api_version)
    headers = _build_headers(provider, api_key)

    body = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,  # laag voor deterministische output
        "response_format": {"type": "json_object"},
    }

    # Voor OpenRouter: model in de body (niet in de URL)
    if provider != "azure":
        body["model"] = model

    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(url, headers=headers, json=body)

                # Transient errors: retry
                if resp.status_code in (429, 502, 503, 504):
                    wait = 2 ** attempt
                    logger.warning(
                        "LLM HTTP %d (attempt %d/%d), waiting %ds",
                        resp.status_code, attempt + 1, max_retries, wait,
                    )
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                data = resp.json()

            content = data["choices"][0]["message"]["content"]

            # Token usage loggen
            usage = data.get("usage", {})
            if usage:
                logger.info(
                    "LLM tokens [%s]: prompt=%d, completion=%d, total=%d",
                    provider,
                    usage.get("prompt_tokens", 0),
                    usage.get("completion_tokens", 0),
                    usage.get("total_tokens", 0),
                )

            logger.debug("LLM response: %s", content[:500])

            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                raise LlmError(f"LLM retourneerde geen geldig JSON: {e}\nContent: {content[:200]}")

        except httpx.TimeoutException as e:
            last_error = e
            wait = 2 ** attempt
            logger.warning("LLM timeout (attempt %d/%d), waiting %ds", attempt + 1, max_retries, wait)
            await asyncio.sleep(wait)
            continue

        except httpx.HTTPStatusError as e:
            # Parse error message
            try:
                error_body = e.response.json()
                error_msg = error_body.get("error", {}).get("message", str(e))
            except Exception:
                error_msg = str(e)
            raise LlmError(f"{provider} HTTP {e.response.status_code}: {error_msg}")

    raise LlmError(f"LLM niet beschikbaar na {max_retries} pogingen: {last_error}")


async def run_classificatie(
    provider: str,
    endpoint: str,
    api_key: str,
    model: str,
    wet: str,
    bwb_id: str,
    artikel: str,
    versiedatum: str,
    bronreferentie: str,
    leden: list[LidData],
) -> Activiteit2Data:
    """Voer activiteit 2 uit: JAS-classificatie van wetsformuleringen.

    Stuurt de wettekst + JAS-klassen naar de LLM en retourneert
    de geclassificeerde markeringen.
    """
    # Bouw de gebruikersprompt met de wettekst
    leden_tekst = "\n\n".join(
        f"**Lid {lid.lid}.** {lid.tekst}" for lid in leden
    )

    user_prompt = f"""Classificeer de volgende wettekst volgens het Juridisch Analyseschema (JAS).

## Wettekst
**Wet:** {wet}
**Artikel:** {artikel}
**Versiedatum:** {versiedatum}
**Bronreferentie:** {bronreferentie}

{leden_tekst}

## JAS-klassen
{JAS_KLASSEN}

Identificeer alle relevante formuleringen, classificeer ze, en beschrijf de samenhang."""

    result = await _call_llm(
        provider=provider,
        endpoint=endpoint,
        api_key=api_key,
        model=model,
        system_prompt=CLASSIFICATIE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
    )

    markeringen = [
        Markering(
            id=m["id"],
            formulering=m["formulering"],
            klasse=m["klasse"],
            vindplaats=m["vindplaats"],
            toelichting=m.get("toelichting", ""),
        )
        for m in result.get("markeringen", [])
    ]

    return Activiteit2Data(
        wet=wet,
        bwb_id=bwb_id,
        artikel=artikel,
        versiedatum=versiedatum,
        bronreferentie=bronreferentie,
        leden=leden,
        markeringen=markeringen,
        samenhang=result.get("samenhang", ""),
    )


async def run_betekenis(
    provider: str,
    endpoint: str,
    api_key: str,
    model: str,
    wet: str,
    bwb_id: str,
    artikel: str,
    versiedatum: str,
    bronreferentie: str,
    activiteit_2: Activiteit2Data,
) -> Activiteit3Data:
    """Voer activiteit 3 uit: begrippen en afleidingsregels vormen.

    Stuurt de geclassificeerde markeringen naar de LLM en retourneert
    begrippen + afleidingsregels.
    """
    # Beperk markeringen tot max 30 om promptgrootte te beperken
    max_markeringen = 30
    markeringen_subset = activiteit_2.markeringen[:max_markeringen]
    markeringen_tekst = "\n".join(
        f"- [{m.id}] \"{m.formulering[:80]}\" -> {m.klasse}"
        for m in markeringen_subset
    )
    if len(activiteit_2.markeringen) > max_markeringen:
        markeringen_tekst += f"\n- ... en {len(activiteit_2.markeringen) - max_markeringen} meer"

    user_prompt = f"""Stel de betekenis vast van de volgende geclassificeerde wetsformuleringen.

## Context
**Wet:** {wet}
**Artikel:** {artikel}
**Versiedatum:** {versiedatum}
**Bronreferentie:** {bronreferentie}

## Geclassificeerde markeringen
{markeringen_tekst}

## Samenhang
{activiteit_2.samenhang}

Maak begrippen en afleidingsregels op basis van de geclassificeerde markeringen.

## Vuistregels
{ACTIVITEIT_3_VUISTREGELS}"""

    result = await _call_llm(
        provider=provider,
        endpoint=endpoint,
        api_key=api_key,
        model=model,
        system_prompt=BETEKENIS_SYSTEM_PROMPT,
        user_prompt=user_prompt,
    )

    begrippen = [
        Begrip(
            id=b["id"],
            naam=b["naam"],
            klasse=b["klasse"],
            definitie=b["definitie"],
            voorbeeld=b.get("voorbeeld", ""),
            kenmerken=b.get("kenmerken", ""),
            vindplaats=b["vindplaats"],
            twijfel=b.get("twijfel", ""),
        )
        for b in result.get("begrippen", [])
    ]

    regels = [
        Afleidingsregel(
            id=r["id"],
            naam=r["naam"],
            type=r["type"],
            uitvoervariabele=r["uitvoervariabele"],
            invoervariabelen=r.get("invoervariabelen", ""),
            parameters=r.get("parameters", ""),
            voorwaarden=r.get("voorwaarden", ""),
            formulering=r.get("formulering", ""),
            vindplaats=r["vindplaats"],
            twijfel=r.get("twijfel", ""),
        )
        for r in result.get("afleidingsregels", [])
    ]

    return Activiteit3Data(
        wet=wet,
        bwb_id=bwb_id,
        artikel=artikel,
        versiedatum=versiedatum,
        bronreferentie=bronreferentie,
        begrippen=begrippen,
        afleidingsregels=regels,
        validatiepunten=result.get("validatiepunten", ""),
    )
