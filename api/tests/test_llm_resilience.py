"""LLM-kostenrem: globale concurrency-limiter (throttle) + slimmere transient-retry (Retry-After)."""

import asyncio

from app.engine.retry import met_retry, retry_after_seconds
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
