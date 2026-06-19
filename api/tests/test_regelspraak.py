"""Tests voor de RegelSpraak-vervolgfase (on-demand op een afgeronde analyse).

Spiegelt test_engine.py: dezelfde FakeLLM/FakeWettenbank, in-memory SQLite-store. Dekt de
autonome doorloop, beide review-checkpoints, de feedback-lus, het mislukt-starten op een niet-
afgeronde analyse, en de tekstexport.
"""

import pytest

from app.contracts import BronInput, Feedback, JobState, StartRequest


def _start_req(review: bool) -> StartRequest:
    return StartRequest(bronnen=[BronInput(bwbId="BWBR9999999", artikel="1")], review=review)


async def _tot_klaar(engine):
    """Breng een analyse autonoom tot `klaar` en geef de job-id terug."""
    job = await engine.create_job(_start_req(review=False), "test")
    await engine.run_initial(job.id)
    return job.id


async def test_regelspraak_autonoom_tot_rs_klaar(engine, store):
    job_id = await _tot_klaar(engine)
    await engine.run_regelspraak(job_id, review=False)

    job = await store.load_job(job_id)
    assert job.state == JobState.rs_klaar
    model = await store.lees_regelspraak(job_id)
    assert model is not None
    assert model["gegevensspraak"]["objecttypen"][0]["naam"] == "belastingplichtige"
    assert model["regels"][0]["id"] == "rs1"
    assert model["regels"][0]["herkomst"]["regel_id"] == "r1"
    # Provenance: act-2 + act-3 (2) + rs-gegevens + rs-regels (2) = 4 rondes.
    activiteiten = [p.activiteit for p in job.provenance]
    assert "rs-gegevens" in activiteiten and "rs-regels" in activiteiten


async def test_regelspraak_start_alleen_vanuit_klaar(engine, store):
    """run_regelspraak op een nog niet afgeronde analyse doet niets (claim faalt)."""
    job = await engine.create_job(_start_req(review=True), "test")
    await engine.run_initial(job.id)  # blijft hangen op wacht-review-act2
    assert (await store.load_job(job.id)).state == JobState.wacht_review_act2

    await engine.run_regelspraak(job.id, review=False)
    # Onveranderd: geen regelspraak gestart.
    assert (await store.load_job(job.id)).state == JobState.wacht_review_act2
    assert await store.lees_regelspraak(job.id) is None


async def test_regelspraak_review_checkpoints(engine, store):
    job_id = await _tot_klaar(engine)
    await engine.run_regelspraak(job_id, review=True)

    # Eerste checkpoint: GegevensSpraak.
    assert (await store.load_job(job_id)).state == JobState.wacht_review_rs_gegevens
    await engine.apply_feedback(job_id, Feedback(status="akkoord", activiteit="rs-gegevens"))

    # Tweede checkpoint: regels.
    assert (await store.load_job(job_id)).state == JobState.wacht_review_rs_regels
    await engine.apply_feedback(job_id, Feedback(status="akkoord", activiteit="rs-regels"))

    job = await store.load_job(job_id)
    assert job.state == JobState.rs_klaar
    assert (await store.lees_regelspraak(job_id)) is not None


async def test_regelspraak_feedback_maakt_nieuwe_ronde(engine, store):
    job_id = await _tot_klaar(engine)
    await engine.run_regelspraak(job_id, review=True)

    # Wijzigingen op de GegevensSpraak → ronde 2, opnieuw in review.
    await engine.apply_feedback(
        job_id,
        Feedback(status="wijzigingen", activiteit="rs-gegevens",
                 items={"ot1": "Voeg een attribuut toe."}),
    )
    job = await store.load_job(job_id)
    assert job.state == JobState.wacht_review_rs_gegevens
    assert job.current_ronde == 2
    assert await store.hoogste_ronde(job_id, "rs-gegevens") == 2


async def test_regelspraak_review_inherit_van_job(engine, store):
    """review=None erft Job.review (hier False via de autonome analyse) → loopt door tot rs_klaar."""
    job_id = await _tot_klaar(engine)
    await engine.run_regelspraak(job_id, review=None)
    assert (await store.load_job(job_id)).state == JobState.rs_klaar


async def test_regelspraak_export_rs_en_md(engine, store):
    from app.engine.render_regelspraak import render_md, render_rs

    job_id = await _tot_klaar(engine)
    await engine.run_regelspraak(job_id, review=False)
    model = await store.lees_regelspraak(job_id)

    rs = render_rs(model)
    assert "Objecttype de belastingplichtige" in rs
    assert "Regel Beslis aangifteplicht" in rs

    md = render_md(model)
    assert "# RegelSpraak-specificatie" in md
    assert "## 1. GegevensSpraak" in md
