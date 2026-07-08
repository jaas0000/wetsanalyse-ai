"""LLM-kostenrem: globale concurrency-limiter (throttle) + slimmere transient-retry (Retry-After)
+ de pre-flight prompt-token-guard en de afgeslankte act-3-prompt (context-window)."""

import asyncio

import pytest

from app.engine.retry import is_transient, met_retry, retry_after_seconds
from app.llm import throttle


# --- #1 concurrency-limiter ---

async def test_llm_slot_begrenst_gelijktijdigheid():
    throttle.configure(2)
    try:
        actief = piek = 0

        async def taak():
            nonlocal actief, piek
            async with throttle.llm_slot():
                actief += 1
                piek = max(piek, actief)
                await asyncio.sleep(0.01)
                actief -= 1

        await asyncio.gather(*(taak() for _ in range(6)))
        assert piek <= 2  # nooit meer dan het plafond tegelijk
    finally:
        throttle.configure(0)


async def test_llm_slot_uit_is_noop():
    throttle.configure(0)
    async with throttle.llm_slot():
        pass  # geen rem, geen blokkade


# --- #2 Retry-After ---

def test_retry_after_uit_attribuut():
    class E(Exception):
        retry_after = 7

    assert retry_after_seconds(E()) == 7.0


def test_retry_after_uit_header():
    class Resp:
        headers = {"retry-after": "12"}

    class E(Exception):
        response = Resp()

    assert retry_after_seconds(E()) == 12.0


def test_retry_after_afwezig():
    assert retry_after_seconds(Exception("geen hint")) is None


async def test_met_retry_honoreert_retry_after(monkeypatch):
    import app.engine.retry as r

    slaapjes: list[float] = []

    async def fake_sleep(s):
        slaapjes.append(s)

    monkeypatch.setattr(r.asyncio, "sleep", fake_sleep)

    class RateLimitError(Exception):  # naam telt als transiënt (is_transient)
        retry_after = 5

    pogingen = {"n": 0}

    async def maak():
        pogingen["n"] += 1
        if pogingen["n"] == 1:
            raise RateLimitError()
        return "ok"

    res = await met_retry(maak, max_retries=3, backoff=0.5, max_backoff=30)
    assert res == "ok" and pogingen["n"] == 2
    # Wachttijd op basis van Retry-After (5s) + jitter ≤ 25%, niet de 0.5s backoff.
    assert 5.0 <= slaapjes[0] <= 6.25


async def test_met_retry_plafonneert_backoff(monkeypatch):
    import app.engine.retry as r

    slaapjes: list[float] = []

    async def fake_sleep(s):
        slaapjes.append(s)

    monkeypatch.setattr(r.asyncio, "sleep", fake_sleep)

    class RateLimitError(Exception):
        pass

    async def maak():
        raise RateLimitError()

    try:
        await met_retry(maak, max_retries=3, backoff=100, max_backoff=10)
    except RateLimitError:
        pass
    # Exponentiële backoff (100, 200, …) wordt geplafonneerd op 10 + max 25% jitter.
    assert all(s <= 12.5 for s in slaapjes)


# --- #3 context-window: afgeslankte act-3-prompt + pre-flight token-guard ---

def test_act3_prompt_bevat_geen_volledige_leden():
    """Act-3 werkt op de markeringen, niet op de volledige wettekst — dat houdt de
    werkgebied-brede prompt binnen het context window."""
    from app.engine.prompts import act3_prompt

    context = {
        "werkgebied": {"naam": "WG"},
        "bronnen": [{
            "bron_id": "br1", "label": "Wet X art. 1", "bwbId": "BWBR1", "artikel": "1",
            "leden": [{"lid": "1", "tekst": "UNIEKE_LEDEN_TEKST_XYZ hoort niet in de act-3-prompt"}],
            "markeringen": [{"id": "m1", "bron_id": "br1", "formulering": "MARKERING_ABC",
                             "klasse": "Rechtssubject", "vindplaats": "lid 1"}],
            "verwijzingen": [],
        }],
    }
    _system, user, _schema, _h = act3_prompt(context)
    assert "UNIEKE_LEDEN_TEKST_XYZ" not in user   # volledige leden-tekst is eruit
    assert "MARKERING_ABC" in user                # markeringen blijven de basis
    assert "br1" in user                          # bron-index aanwezig voor vindplaatsen


def test_prompt_guard_werpt_bij_overschrijding():
    from app.llm.base import LlmConfig, PromptTooLargeError
    from app.llm.litellm_client import LiteLLMClient

    client = LiteLLMClient(LlmConfig(model="gpt-test", max_prompt_tokens=10))
    with pytest.raises(PromptTooLargeError):
        # ~250 tokens via de chars/4-fallback ≫ cap 10.
        client._guard_prompt([{"role": "user", "content": "x" * 1000}])


def test_prompt_guard_laat_klein_door_en_noop_zonder_limiet():
    from app.llm.base import LlmConfig
    from app.llm.litellm_client import LiteLLMClient

    # Onder de cap → geen fout.
    LiteLLMClient(LlmConfig(model="gpt-test", max_prompt_tokens=100000))._guard_prompt(
        [{"role": "user", "content": "kort"}]
    )
    # Geen cap + onbekend model → geen afleidbare limiet → geen fout, ongeacht grootte.
    LiteLLMClient(LlmConfig(model="onbekend-model-zzz", max_prompt_tokens=0))._guard_prompt(
        [{"role": "user", "content": "x" * 100000}]
    )


def test_prompt_too_large_niet_transient():
    from app.llm.base import PromptTooLargeError

    # Niet-transiënt → wordt door met_retry niet 5× herhaald.
    assert is_transient(PromptTooLargeError("te groot")) is False


# --- #4 MCP-foutklasse: client-fouten (niet-bestaand artikel) niet retryen ---

def test_wettenbank_client_fout_niet_transient():
    from app.wettenbank import WettenbankError

    assert is_transient(WettenbankError("artikel niet gevonden", klasse="client")) is False
    assert is_transient(WettenbankError("regeling bestaat niet", klasse="permanent")) is False
    # Zonder klasse (transportfout) of met transiënte klasse blijft retryen het gedrag.
    assert is_transient(WettenbankError("fetch failed")) is True
    assert is_transient(WettenbankError("SRU 503", klasse="transient")) is True


async def test_met_retry_stopt_direct_op_client_fout(monkeypatch):
    import app.engine.retry as r
    from app.wettenbank import WettenbankError

    monkeypatch.setattr(r.asyncio, "sleep", lambda s: pytest.fail("mag niet slapen"))
    pogingen = 0

    async def maak():
        nonlocal pogingen
        pogingen += 1
        raise WettenbankError("Artikel 999 niet gevonden", klasse="client")

    with pytest.raises(WettenbankError):
        await met_retry(maak, max_retries=3, backoff=0.1)
    assert pogingen == 1  # geen backoff-loop op een permanente client-fout


def test_parse_zet_foutklasse_op_wettenbank_error():
    """De MCP stuurt de fout als JSON {"fout","foutCode","klasse"} in het text-block;
    _parse moet de klasse op de exceptie zetten (best-effort: geen JSON → None)."""
    import json

    from app.wettenbank import WettenbankClient, WettenbankError

    class Block:
        type = "text"

        def __init__(self, text: str) -> None:
            self.text = text

    class Result:
        isError = True

        def __init__(self, text: str) -> None:
            self.content = [Block(text)]

    payload = json.dumps({"fout": "Artikel 999 niet gevonden", "foutCode": "ARTIKEL_NIET_GEVONDEN", "klasse": "client"})
    with pytest.raises(WettenbankError) as ei:
        WettenbankClient._parse("wettenbank_artikel", Result(payload))
    assert ei.value.klasse == "client"
    assert "Artikel 999 niet gevonden" in str(ei.value)

    with pytest.raises(WettenbankError) as ei:
        WettenbankClient._parse("wettenbank_artikel", Result("kale foutmelding, geen JSON"))
    assert ei.value.klasse is None
