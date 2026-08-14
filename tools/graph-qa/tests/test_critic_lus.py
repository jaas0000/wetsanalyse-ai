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
    jurist met het laatste oordeel erbij.

    De annoteerder past hier elke ronde iets aan; zou hij dat niet doen, dan stopt de lus al eerder op
    stilstand (zie `test_een_herziening_zonder_wijziging_stopt_de_lus`). Dit test dus echt het
    plafond, niet de convergentie.
    """
    blijft_rood = lambda klasse: _critic([{  # noqa: E731
        "id": "el-a", "aandacht": "rood", "motivatie": "nog steeds mis",
        "actie": "vervang", "voorstel_klasse": klasse,
    }])
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood("Voorwaarde"),                                                      # ronde 1
        _annoteer([{"id": "el-a", "klasse": "Voorwaarde", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood("Rechtssubject"),                                                   # ronde 2
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        blijft_rood("Rechtsobject"),                                                    # zou ronde 3 zijn
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert len(elementen) == 1
    assert elementen[0]["aandacht"] == "rood", "het laatste oordeel gaat mee naar de jurist"
    # Default 2 rondes: aanloop(3) + annoteer + critic + 2x (herzie + critic) = 9 calls.
    assert llm.index == 9, f"verwacht precies 2 herzieningen, kreeg {llm.index} LLM-calls"
    assert any("rondelimiet bereikt" in e["message"] for e in events if e["type"] == "status"), \
        "de tijdlijn hoort te melden dát het plafond de reden was"


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


def test_een_herziening_zonder_wijziging_stopt_de_lus():
    """Levert een herziening niets op, dan heeft nog een Critic-pas geen zin: die zou exact dezelfde
    voorstellen opnieuw beoordelen, met het volle corpus erbij.

    (Deze test dekte eerder alleen dat zo'n ronde meetelde voor het plafond. Dat klopt nog steeds —
    de teller telt pogingen — maar sinds de lus op stilstand stopt, komt het niet meer tot een tweede
    poging.)
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
        leeg(),                     # herziening 1 levert niets op → hier hoort het te stoppen
        blijft_rood(),              # deze Critic-pas mag niet meer gebeuren
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert llm.index == 6, f"aanloop(3) + annoteer + critic + herzie = 6, niet {llm.index}"
    assert len(elementen) == 1, "de mislukte herziening laat het voorstel staan"
    assert elementen[0]["klasse"] == "Rechtsfeit"
    assert any("geen wijziging meer" in e["message"] for e in events if e["type"] == "status")


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


# --- het samenspel is te volgen ------------------------------------------------------------------
#
# De keten deed er 60-90 seconden over en stuurde in die tijd geen enkel event: de jurist keek naar
# een leeg scherm terwijl annoteerder en Critic aan het werk waren.

def _statusregels(events) -> list[str]:
    return [e["message"] for e in events if e["type"] == "status"]


def test_elke_fase_meldt_zich_met_naam_en_uitkomst():
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "dit is een subject",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
    ])
    _, events = _annoteer_uitkomst(llm)
    regels = _statusregels(events)
    tekst = "\n".join(regels)

    for merk in ("Supervisor ·", "Graaf bevragen ·", "Annoteerder ·", "Critic ·", "Herziening 1 ·", "Klaar ·"):
        assert merk in tekst, f"{merk!r} ontbreekt in de tijdlijn:\n{tekst}"

    # De volgorde vertelt het verhaal: eerst annoteren, dan de kritiek, dan de correctie.
    volgorde = [i for i, r in enumerate(regels)
                if r.startswith(("Annoteerder ·", "Critic ·", "Herziening 1 ·", "Klaar ·"))]
    assert volgorde == sorted(volgorde)
    assert regels.index(next(r for r in regels if r.startswith("Herziening 1"))) > \
        regels.index(next(r for r in regels if r.startswith("Critic ·")))


def test_de_melding_telt_wat_er_daadwerkelijk_uitkomt():
    """Een teller die niet klopt met de lijst eronder ondermijnt het hele doel van meekijken."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"id": "el-b", "klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
            {"id": "el-c", "klasse": "Rechtsfeit", "tekst": "staat niet in de tekst", "lid": "1"},
        ]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "ok"},
                 {"id": "el-b", "aandacht": "groen", "motivatie": "ok"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm)
    regels = _statusregels(events)

    annoteer = next(r for r in regels if r.startswith("Annoteerder ·") and "gegrond" in r)
    assert "3 fragmenten, 2 gegrond" in annoteer
    assert "1 verworpen (1× niet letterlijk)" in annoteer
    assert any(r.startswith("Klaar · ") and f"{len(elementen)} elementen ter beoordeling" in r
               for r in regels)


def test_zonder_lus_geen_herzieningsregel():
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Voorwaarde"}]),
    ])
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True, critic_max_rondes=0),
        llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    assert not any(r.startswith("Herziening") for r in _statusregels(events))


def test_een_uitgevallen_critic_meldt_zich():
    """Stil doorgaan zou de indruk wekken dat alles beoordeeld is."""
    class Stukke(FakeLLM):
        def create(self, **kw):
            if "CRITIC" in (kw.get("system") or "").upper():
                raise RuntimeError("critic plat")
            return super().create(**kw)

    llm = Stukke([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
    ])
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True), llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    assert any("overgeslagen (fout)" in r for r in _statusregels(events))


def test_elke_statusregel_volgt_hetzelfde_idioom():
    """`Actor · wat er gebeurde` — anders staan er twee dialecten in één tijdlijn.

    Voor de helper `_stap` bestond, verzon elke node zijn eigen vorm: "Opgesplitst in 3 deelvragen."
    naast "Annoteerder · 4 gegrond", en twee verschillende teksten voor dezelfde graafbevraging.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Voorwaarde"}]),
        _annoteer([{"id": "el-a", "klasse": "Voorwaarde", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "ok"}]),
    ])
    _, events = _annoteer_uitkomst(llm)

    for regel in _statusregels(events):
        actor, scheiding, rest = regel.partition(" · ")
        assert scheiding, f"geen actor in {regel!r}"
        assert actor and actor[0].isupper(), f"actor niet als naam geschreven: {regel!r}"
        assert rest.strip(), f"actor zonder uitkomst: {regel!r}"
        assert not rest.strip().endswith("."), f"geen punt aan het eind: {regel!r}"


# --- convergentie: de lus stopt als er niets meer te doen is --------------------------------------

def test_een_herhaald_gemist_element_start_maar_een_ronde():
    """De Critic bedacht elke ronde opnieuw wat er "mist", dus was er altijd een reden om door te
    gaan. Alleen wat hij nog niet eerder noemde is werk."""
    zelfde_gemist = lambda: _critic(  # noqa: E731
        [{"id": "el-a", "aandacht": "groen", "motivatie": "ok"}],
        [{"klasse": "Voorwaarde", "reden": "niet gemarkeerd", "tekst": "indien de schuldenaar daarom verzoekt"}],
    )
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        zelfde_gemist(),
        # De herziening voegt de Voorwaarde toe; de Critic meldt hem dáárna nog een keer.
        _annoteer([
            {"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"},
            {"klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
        ]),
        zelfde_gemist(),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
    ])
    _, events = _annoteer_uitkomst(llm)

    regels = _statusregels(events)
    assert sum(1 for r in regels if r.startswith("Herziening")) == 1, \
        f"één herziening verwacht, kreeg:\n" + "\n".join(regels)
    assert any("geen open punten" in r for r in regels)
    assert any("niets nieuws" in r for r in regels), "de tijdlijn hoort te tonen dat hij zich herhaalt"


def test_afgewezen_kritiek_start_geen_nieuwe_ronde():
    """Laat de annoteerder een vervang-instructie liggen, dan is dat een gemotiveerd
    meningsverschil — geen reden om de discussie te herhalen."""
    zelfde_kritiek = lambda: _critic([{  # noqa: E731
        "id": "el-a", "aandacht": "rood", "motivatie": "moet Voorwaarde zijn",
        "actie": "vervang", "voorstel_klasse": "Voorwaarde",
    }])
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        zelfde_kritiek(),
        # De annoteerder is het oneens: hij geeft het element ongewijzigd terug, mét een ander element
        # erbij zodat de ronde wél iets veranderde (anders stopt de lus al op stilstand).
        _annoteer([
            {"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"},
            {"klasse": "Voorwaarde", "tekst": "indien de schuldenaar daarom verzoekt", "lid": "1"},
        ]),
        zelfde_kritiek(),
        _annoteer([{"id": "el-a", "klasse": "Voorwaarde", "tekst": "De ontvanger", "lid": "1"}]),
    ])
    _, events = _annoteer_uitkomst(llm)

    regels = _statusregels(events)
    assert sum(1 for r in regels if r.startswith("Herziening")) == 1, \
        "dezelfde afgewezen instructie mag geen tweede ronde starten"
    assert any("geen open punten" in r for r in regels)


def test_de_critic_krijgt_zijn_vorige_oordeel_terug():
    """Anders begint hij elke ronde met een schone lei en kan hij nooit zeggen: dit is opgelost."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "dit is een subject",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "opgelost"}]),
    ])
    _annoteer_uitkomst(llm)

    # De tweede Critic-call (index 6 in de reeks) moet de geschiedenis bevatten.
    tweede_critic = llm.calls[6]["messages"][0]["content"]
    assert "WAT JE VORIGE RONDE ZEI" in tweede_critic
    assert "rood · vervang → Rechtssubject" in tweede_critic
    assert "AANGEPAST" in tweede_critic

    eerste_critic = llm.calls[4]["messages"][0]["content"]
    assert "WAT JE VORIGE RONDE ZEI" not in eerste_critic, "ronde 1 heeft geen geschiedenis"


def test_elk_element_draagt_zijn_rondegeschiedenis():
    """`critic_rondes` bestond al in het api-contract maar werd nooit gevuld — terwijl juist dat de
    geschiedenis is die de Critic, de jurist én de api nodig hebben."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
        _annoteer([{"id": "el-a", "klasse": "Rechtssubject", "tekst": "De ontvanger", "lid": "1"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    rondes = elementen[0]["critic_rondes"]
    assert [r["ronde"] for r in rondes] == [1, 2]
    assert [r["aandacht"] for r in rondes] == ["rood", "groen"]
    assert rondes[0]["voorstel_klasse"] == "Rechtssubject"
