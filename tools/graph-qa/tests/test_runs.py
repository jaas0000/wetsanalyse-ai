"""Het run-register: een beurt overleeft de kijker.

De eigenschap die hier bewaakt wordt is precies de bug die dit oploste: losraken van de eventstroom
mag een lopende beurt niet doden. De rest (replay, cappen, 409) bewaakt dat opnieuw aanhaken een
eerlijk beeld geeft in plaats van een verminkt antwoord.
"""
from __future__ import annotations

import asyncio
import functools

import pytest

from agent.runs import RunBestaatAl, RunRegister


def asyncio_test(fn):
    """graph-qa heeft geen pytest-asyncio; de bestaande tests draaien hun coroutines zelf met
    `asyncio.run` (zie tests/test_agent_loop.py). Deze decorator doet dat voor een hele test."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


def _stroom(events, *, vertraag: float = 0.0):
    """Een nagebootste answer_stream: levert `events`, eventueel met een pauze ertussen."""
    async def maak(_run):
        for event in events:
            if vertraag:
                await asyncio.sleep(vertraag)
            yield event
    return maak


async def _wacht_af(run) -> None:
    if run.taak:
        await run.taak


async def _verzamel(register, run):
    return [e async for e in register.volg(run)]


@asyncio_test
async def test_run_overleeft_het_sluiten_van_de_eventstroom():
    """De kern: één kijker haakt af, de run loopt door en maakt zijn werk af."""
    register = RunRegister()
    events = [{"type": "token", "content": str(i)} for i in range(5)] + [{"type": "done"}]
    run = register.start(conversation_id="g1", vraag="vraag?", maak_stroom=_stroom(events, vertraag=0.01))

    # Kijk één event mee en loop dan weg — precies wat een remount doet.
    stroom = register.volg(run)
    eerste = await anext(stroom)
    await stroom.aclose()
    assert eerste["type"] == "token"
    assert run.loopt

    await _wacht_af(run)
    assert run.status == "klaar"
    assert run.volgende_seq == 6  # alle events zijn geproduceerd, ook zonder kijker


@asyncio_test
async def test_aanhaken_vanaf_seq_levert_precies_het_gemiste():
    register = RunRegister()
    events = [{"type": "token", "content": c} for c in "abcd"] + [{"type": "done"}]
    run = register.start(conversation_id="g1", vraag="v", maak_stroom=_stroom(events))
    await _wacht_af(run)

    vanaf_twee = [e async for e in register.volg(run, vanaf=2)]
    assert [e.get("content") for e in vanaf_twee if e["type"] == "token"] == ["c", "d"]
    # Elk frame draagt zijn eigen seq, zodat een client weet waar hij gebleven is.
    assert [e["seq"] for e in vanaf_twee] == [2, 3, 4]


@asyncio_test
async def test_twee_kijkers_zien_dezelfde_volgorde():
    """Meerdere tabbladen op één run: een append-only log met eigen cursors, geen queue die je maar
    één keer kunt leegdrinken."""
    register = RunRegister()
    events = [{"type": "token", "content": c} for c in "xyz"] + [{"type": "done"}]
    run = register.start(conversation_id="g1", vraag="v", maak_stroom=_stroom(events, vertraag=0.01))

    beide = await asyncio.gather(_verzamel(register, run), _verzamel(register, run))
    assert beide[0] == beide[1]
    assert [e["seq"] for e in beide[0]] == [0, 1, 2, 3]


@asyncio_test
async def test_tweede_run_op_hetzelfde_gesprek_wordt_geweigerd():
    """Twee lussen op één thread_id zouden door elkaar in de checkpointer schrijven."""
    register = RunRegister()
    traag = _stroom([{"type": "token", "content": "x"}, {"type": "done"}], vertraag=0.05)
    eerste = register.start(conversation_id="g1", vraag="v", maak_stroom=traag)

    with pytest.raises(RunBestaatAl) as fout:
        register.start(conversation_id="g1", vraag="v2", maak_stroom=traag)
    assert fout.value.run_id == eerste.run_id  # zodat de client kan aanhaken i.p.v. falen

    await _wacht_af(eerste)
    # Is hij klaar, dan mag er weer een nieuwe beurt op hetzelfde gesprek.
    tweede = register.start(conversation_id="g1", vraag="v2", maak_stroom=_stroom([{"type": "done"}]))
    await _wacht_af(tweede)
    assert tweede.run_id != eerste.run_id


@asyncio_test
async def test_een_ander_gesprek_mag_wel_tegelijk():
    register = RunRegister()
    traag = _stroom([{"type": "done"}], vertraag=0.05)
    a = register.start(conversation_id="g1", vraag="v", maak_stroom=traag)
    b = register.start(conversation_id="g2", vraag="v", maak_stroom=traag)
    assert a.run_id != b.run_id
    await asyncio.gather(_wacht_af(a), _wacht_af(b))


@asyncio_test
async def test_cappen_gooit_narratie_weg_maar_nooit_betekenis():
    """Een generieke ringbuffer zou het begin van het antwoord opeten. Alleen token/reason/status
    mogen sneuvelen — een element dat stilzwijgend verdwijnt is een verminkte annotatie."""
    register = RunRegister(max_events=5)
    events = (
        [{"type": "doel", "doel": {"artikel": "9"}}]
        + [{"type": "token", "content": str(i)} for i in range(20)]
        + [{"type": "element", "element": {"id": "e1"}}, {"type": "done"}]
    )
    run = register.start(conversation_id="g1", vraag="v", maak_stroom=_stroom(events))
    await _wacht_af(run)

    types = [e["type"] for e in run.events]
    assert "doel" in types and "element" in types and "done" in types
    assert run.weggevallen > 0
    assert len(run.events) <= 5


@asyncio_test
async def test_gat_wordt_benoemd_bij_aanhaken():
    """Wie te laat aanhaakt hoort te weten dát er iets mist, in plaats van een tekst te lezen die
    compleet lijkt maar het niet is."""
    register = RunRegister(max_events=3)
    events = [{"type": "token", "content": str(i)} for i in range(10)] + [{"type": "done"}]
    run = register.start(conversation_id="g1", vraag="v", maak_stroom=_stroom(events))
    await _wacht_af(run)

    geleverd = [e async for e in register.volg(run, vanaf=0)]
    assert geleverd[0]["type"] == "gat"
    assert geleverd[0]["weggevallen"] == run.weggevallen


@asyncio_test
async def test_stoppen_is_een_verzoek_geen_annulering():
    """`vraag_stop` zet een vlag; er wordt niets ge-cancelled. De driver leest hem op zijn eigen
    grens — dat is waarom stoppen tijd mag kosten."""
    register = RunRegister()
    gezien: list[bool] = []

    async def maak(run):
        for i in range(10):
            gezien.append(run.stop_gevraagd)
            if run.stop_gevraagd:
                return
            await asyncio.sleep(0.01)
            yield {"type": "token", "content": str(i)}

    run = register.start(conversation_id="g1", vraag="v", maak_stroom=maak)
    await asyncio.sleep(0.03)
    register.vraag_stop(run)
    await _wacht_af(run)

    assert run.status == "gestopt"
    assert any(gezien)


@asyncio_test
async def test_actieve_run_is_wat_de_werkplek_bij_binnenkomst_vraagt():
    register = RunRegister()
    assert register.actief_voor("g1") is None

    run = register.start(conversation_id="g1", vraag="Annoteer artikel 9", maak_stroom=_stroom([{"type": "done"}]))
    await _wacht_af(run)

    gevonden = register.actief_voor("g1")
    assert gevonden is not None
    # De vraag reist mee: anders ziet een vers tabblad tokens zonder user-bubbel erboven.
    assert gevonden.samenvatting()["vraag"] == "Annoteer artikel 9"


@asyncio_test
async def test_afgeronde_run_verdwijnt_na_de_bewaartermijn():
    register = RunRegister(bewaar_s=0.0)
    run = register.start(conversation_id="g1", vraag="v", maak_stroom=_stroom([{"type": "done"}]))
    await _wacht_af(run)
    await asyncio.sleep(0.01)
    assert register.get(run.run_id) is None


@asyncio_test
async def test_fout_in_de_stroom_wordt_een_error_event():
    register = RunRegister()

    async def stuk(_run):
        yield {"type": "token", "content": "half"}
        raise RuntimeError("kapot")

    run = register.start(conversation_id="g1", vraag="v", maak_stroom=stuk)
    await _wacht_af(run)
    assert run.status == "mislukt"
    assert run.events[-1]["type"] == "error"
    # De ruwe fout hoort niet in de browser.
    assert "kapot" not in run.events[-1]["message"]
