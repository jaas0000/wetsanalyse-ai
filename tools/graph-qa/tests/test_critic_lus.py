"""De herzieningslus annoteerder ⇄ Critic.

`annoteer → critic → (herzie → critic)* → emit`, begrensd door `critic_max_rondes`. De Critic wijst
aan wát er mis is, de annoteerder herstelt het, en pas daarna ziet de jurist de uitkomst.

FakeLLM-volgorde per annotatie: supervisor(create) → ophaal turn1(stream, tool_use) →
ophaal turn2(stream, doel-JSON) → annoteer(create) → critic(create) → [herzie(create) → critic(create)]*
"""
from __future__ import annotations

import asyncio
import json

from agent.agent import answer_stream
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block, tool_block

LID_TSV = json.dumps(
    '?nummer\t?tekst\t?jci\n"1"\t"De ontvanger verleent uitstel van betaling indien de schuldenaar '
    'daarom verzoekt."@nl\t"jci"'
)


def _run(gen):
    async def collect():
        return [ev async for ev in gen]

    return asyncio.run(collect())


def _aanloop() -> list:
    """Supervisor + de twee ophaal-beurten; identiek voor elk scenario hieronder."""
    return [
        response([text_block("WORKERS: annotatie\nPLAN: annoteer art 9 lid 1")], "end_turn"),
        response([tool_block("t1", "get_lid", {"bwb_id": "BWBR0004770", "artikel": "9", "lid": "1"})], "tool_use"),
        response([text_block('{"bwbId":"BWBR0004770","artikel":"9","lid":"1"}')], "end_turn"),
    ]


def _annoteer(elementen: list[dict]):
    return response([text_block(json.dumps({"elementen": elementen}))], "end_turn")


def _critic(oordelen: list[dict], ontbrekend: list[dict] | None = None):
    return response(
        [text_block(json.dumps({"oordelen": oordelen, "ontbrekend": ontbrekend or []}))], "end_turn"
    )


def _annoteer_uitkomst(llm: FakeLLM):
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True), llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    return [e["element"] for e in events if e["type"] == "element"], events


def test_critic_vraagt_herziening_en_de_annoteerder_past_aan():
    """De kern: een rood oordeel met een vervang-instructie leidt tot een herziene klasse, met
    behoud van het id — anders raakt het werk van de jurist aan dat element los."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "dit is een subject",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert len(elementen) == 1, "de werkplek mag alleen de eindversie zien, niet elke tussenronde"
    assert elementen[0]["id"] == "el-a"
    assert elementen[0]["klasse"] == "Rechtssubject"
    assert elementen[0]["aandacht"] == "groen"


def test_lus_stopt_na_het_maximum_aantal_rondes():
    """Een Critic die rood blijft geven mag niet eindeloos doorgaan; wat overblijft gaat naar de
    jurist met het laatste oordeel erbij."""
    blijft_rood = lambda: _critic([{  # noqa: E731
        "id": "el-a", "aandacht": "rood", "motivatie": "nog steeds mis",
        "actie": "vervang", "voorstel_klasse": "Voorwaarde",
    }])
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood(),                                                                  # ronde 1
        _annoteer([{"id": "el-a", "klasse": "Voorwaarde", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood(),                                                                  # ronde 2
        _annoteer([{"id": "el-a", "klasse": "Voorwaarde", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood(),                                                                  # zou ronde 3 zijn
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert len(elementen) == 1
    assert elementen[0]["aandacht"] == "rood", "het laatste oordeel gaat mee naar de jurist"
    # Default 2 rondes: aanloop(3) + annoteer + critic + 2x (herzie + critic) = 9 calls.
    assert llm.index == 9, f"verwacht precies 2 herzieningen, kreeg {llm.index} LLM-calls"


def test_geen_actiepunten_slaat_de_lus_over():
    """Bij een schone annotatie kost de lus niets — dat is het normale geval."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert elementen[0]["aandacht"] == "groen"
    assert llm.index == 5, "alleen aanloop + annoteer + critic; geen herziening"


def test_geel_alleen_is_geen_reden_voor_een_herziening():
    """Geel is een aandachtspunt voor de jurist, geen correctie-opdracht."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "geel", "motivatie": "grensgeval", "actie": "behoud"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert elementen[0]["aandacht"] == "geel"
    assert llm.index == 5


def test_verworpen_fragment_lokt_een_herziening_uit_en_staat_in_de_prompt():
    """Een citaat dat niet letterlijk in de tekst staat is de goedkoopste correctie die er is."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Voorwaarde", "tekst": "als de schuldenaar dat vraagt", "lid": "1"},
        ]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}]),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
        ]),
        _critic([
            {"id": "el-a", "aandacht": "groen", "motivatie": "helder"},
            {"id": "el-b", "aandacht": "groen", "motivatie": "nu letterlijk"},
        ]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert len(elementen) == 2, "het gerepareerde fragment hoort er nu wel in te staan"
    assert "indien de schuldenaar daarom verzoekt" in {e["tekst"] for e in elementen}

    # Het verworpen fragment moet als aanwijzing in de herzieningsprompt hebben gestaan.
    herzien_prompt = llm.calls[5]["messages"][0]["content"]
    assert "EERDER VERWORPEN" in herzien_prompt
    assert "als de schuldenaar dat vraagt" in herzien_prompt


def test_ontbrekend_element_wordt_toegevoegd_in_de_herziening():
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic(
            [{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}],
            ontbrekend=[{"klasse": "Voorwaarde", "reden": "de conditie is niet gemarkeerd",
                         "tekst": "indien de schuldenaar daarom verzoekt"}],
        ),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "", "klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
        ]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert {e["klasse"] for e in elementen} == {"Rechtssubject", "Voorwaarde"}


def test_verwijder_instructie_haalt_het_element_weg():
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Voorwaarde", "tekst": "verleent uitstel", "lid": "1"},
        ]),
        _critic([
            {"id": "el-a", "aandacht": "groen", "motivatie": "helder"},
            {"id": "el-b", "aandacht": "rood", "motivatie": "geen JAS-element", "actie": "verwijder"},
        ]),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert [e["id"] for e in elementen] == ["el-a"]


def test_mislukte_herziening_behoudt_de_vorige_uitkomst():
    """Een herziening die stukloopt mag nooit minder opleveren dan we al hadden."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
        # De herziening levert niets gegronds: het fragment staat niet in de tekst.
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "staat hier niet in de tekst"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert len(elementen) == 1
    assert elementen[0]["klasse"] == "Rechtsfeit", "de oorspronkelijke versie blijft staan"
    assert elementen[0]["aandacht"] == "rood", "en de jurist ziet dat er twijfel is"


def test_gefaalde_critic_laat_de_herziening_staan():
    """Loopt de tweede Critic-pas stuk, dan gaat de herziene uitkomst gewoon naar de jurist.

    Let op het onderscheid in de oordelen: een element dat de herziening ONGEWIJZIGD liet houdt zijn
    eerdere oordeel (dat geldt nog), maar een element dat is aangepast staat zonder aandacht — die
    versie is nooit beoordeeld, en er een oud oordeel op plakken zou schijnzekerheid zijn.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Rechtsbetrekking", "tekst": "verleent uitstel van betaling", "lid": "1"},
        ]),
        _critic([
            {"id": "el-a", "aandacht": "rood", "motivatie": "verkeerde klasse",
             "actie": "vervang", "voorstel_klasse": "Rechtssubject"},
            {"id": "el-b", "aandacht": "groen", "motivatie": "helder"},
        ]),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Rechtsbetrekking", "tekst": "verleent uitstel van betaling", "lid": "1"},
        ]),
        # geen respons meer → de tweede critic-pas raist (FakeLLM IndexError)
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    op_id = {e["id"]: e for e in elementen}
    assert set(op_id) == {"el-a", "el-b"}
    assert op_id["el-a"]["klasse"] == "Rechtssubject", "de herziening is doorgevoerd"
    assert op_id["el-a"]["aandacht"] == "", "gewijzigd en niet opnieuw beoordeeld"
    assert op_id["el-b"]["aandacht"] == "groen", "ongewijzigd, dus het oordeel geldt nog"


def test_tweede_beurt_in_dezelfde_thread_reset_de_rondeteller(tmp_path):
    """De checkpointer bewaart de state per thread; zonder reset zou beurt 2 met een volle teller
    beginnen en de lus overslaan."""
    settings = make_settings(enable_decomposition=True, checkpoint_db_path=str(tmp_path / "cp.db"))

    def scenario():
        return [
            *_aanloop(),
            _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
            _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                      "voorstel_klasse": "Rechtssubject"}]),
            _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
            _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
        ]

    def beurt(llm: FakeLLM):
        return _run(answer_stream(
            "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
            settings=settings, llm=llm, graph=FakeGraph(result=LID_TSV), conversation_id="thread-1",
        ))

    beurt(FakeLLM(scenario()))
    tweede = FakeLLM(scenario())
    events = beurt(tweede)

    elementen = [e["element"] for e in events if e["type"] == "element"]
    assert elementen[0]["klasse"] == "Rechtssubject"
    assert tweede.index == 7, "beurt 2 moet de lus opnieuw kunnen draaien"


def test_klep_uit_reproduceert_het_oude_gedrag():
    """`critic_max_rondes=0` moet exact de oude keten geven: annoteer → critic → emit, geen herziening.

    Dit is de terugvaloptie in productie: gaat de lus zich misdragen, dan is één env-var genoeg om
    terug te vallen zonder deploy-rollback. Dat moet dus ook echt werken.
    """
    scenario = [
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        # Rood MET vervang-instructie: met de lus aan zou dit gegarandeerd een herziening uitlokken.
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
    ]
    llm = FakeLLM(scenario)
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True, critic_max_rondes=0),
        llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    elementen = [e["element"] for e in events if e["type"] == "element"]

    assert llm.index == 5, "geen enkele extra LLM-call"
    assert elementen[0]["klasse"] == "Rechtsfeit", "niets herzien"
    assert elementen[0]["aandacht"] == "rood", "de jurist krijgt het oordeel wel te zien"
    # En de samenvatting rept niet over herzieningen.
    tokens = "".join(e["content"] for e in events if e["type"] == "token")
    assert "herziening" not in tokens


def test_een_onproductieve_herziening_telt_ook_mee():
    """Anders is `critic_max_rondes` geen plafond.

    Een herziening die niets gegronds oplevert liet de teller ongemoeid, terwijl `ontbrekend` in de
    state bleef staan — dus de route sprong er meteen weer in. Op dev gaf dat vier herzieningen bij
    een maximum van twee: acht LLM-calls die de knop juist hoort af te grendelen. Een ronde die een
    LLM-call kost, is een ronde.
    """
    leeg = lambda: response([text_block("geen JSON hier")], "end_turn")  # noqa: E731
    blijft_rood = lambda: _critic(  # noqa: E731
        [{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
          "voorstel_klasse": "Rechtssubject"}],
        [{"klasse": "Voorwaarde", "reden": "niet gemarkeerd"}],
    )
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood(),
        leeg(), blijft_rood(),      # herziening 1: niets gegronds
        leeg(), blijft_rood(),      # herziening 2: idem — hierna is het maximum op
        leeg(), blijft_rood(),      # zou een derde ronde zijn: mag niet gebeuren
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert llm.index == 9, f"aanloop(3) + annoteer + critic + 2x(herzie+critic) = 9, niet {llm.index}"
    assert len(elementen) == 1, "de mislukte herzieningen laten het voorstel staan"
    assert elementen[0]["klasse"] == "Rechtsfeit"


def test_een_herziening_zonder_id_dupliceert_het_element_niet():
    """Het geval van dev: de herziening stelt een bestaand fragment opnieuw voor, maar vergeet het id.

    Zonder koppeling op inhoud kreeg dat een vers id en stond dezelfde markering er twee keer — twee
    identieke kaartjes in de reviewlijst. Het oudste id wint, want daaraan hangen de beslissingen van
    de jurist en het auditspoor.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "ok"}],
                [{"klasse": "Voorwaarde", "reden": "de conditie is niet gemarkeerd",
                  "tekst": "indien de schuldenaar daarom verzoekt"}]),
        # De herziening voegt de Voorwaarde toe en herhaalt het subject — zonder id.
        _annoteer([
            {"klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
        ]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "ok"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    assert len(elementen) == 2, f"subject + voorwaarde, geen duplicaat: {[e['tekst'] for e in elementen]}"
    subject = next(e for e in elementen if e["klasse"] == "Rechtssubject")
    assert subject["id"] == "el-a", "het oudste id blijft, anders raakt het werk van de jurist los"
    assert subject["aandacht"] == "groen", "inhoudelijk ongewijzigd, dus het oordeel geldt nog"
