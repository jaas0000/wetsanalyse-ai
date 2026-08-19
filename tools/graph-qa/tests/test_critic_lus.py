"""De correctieketen na de Critic.

`annoteer → critic₁ → patch → [herzie] → [critic₂] → emit` — **lineair, geen cyclus**. De Critic
wijst aan wát er mis is, *code* voert de eenduidige correcties uit (`annotatie.pas_critic_toe`), en
het model draait alleen nog voor wat brontekst lezen vraagt: een bijna-goed citaat repareren en een
gemeld ontbrekend element toevoegen.

Dit ving eerder een echte lus af (`critic ⇄ herzie`) met vier guards om hem te laten stoppen. Die
tests zijn met de topologie meeverhuisd; wat blijft is wat de jurist ervan merkt.

FakeLLM-volgorde per annotatie: supervisor(create) → ophaal turn1(stream, tool_use) →
ophaal turn2(stream, doel-JSON) → annoteer(create) → critic(create) → [herzie(create)] → [critic(create)]

Tellen dus: 3 aanloop + 2 = **5** bij een schone annotatie · **6** als de patcher iets deed ·
**7** als er ook een herziening nodig was. Meer kan niet.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from agent.agent import answer_stream
from agent.annotatie import pas_critic_toe
from fakes import FakeGraph, FakeLLM, make_settings, response, text_block, tool_block

LID_TSV = json.dumps(
    '?nummer\t?tekst\t?jci\n"1"\t"De ontvanger verleent uitstel van betaling indien de schuldenaar '
    'daarom verzoekt."@nl\t"jci"'
)
CORPUS = "De ontvanger verleent uitstel van betaling indien de schuldenaar daarom verzoekt."

SCHOON = 5
NA_PATCH = 6
NA_HERZIENING = 7


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


def _annoteer_uitkomst(llm: FakeLLM, **kw):
    events = _run(answer_stream(
        "annoteer artikel 9 lid 1 van de Invorderingswet 1990",
        settings=make_settings(enable_decomposition=True, **kw), llm=llm, graph=FakeGraph(result=LID_TSV),
    ))
    return [e["element"] for e in events if e["type"] == "element"], events


def _statusregels(events) -> list[str]:
    return [e["message"] for e in events if e["type"] == "status"]


_EL = {"id": "el-a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "lid": "1"}


# --- de patcher als pure functie ------------------------------------------------------------------

def test_vervang_klasse_wordt_toegepast_bij_rood():
    uit, n, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger"}],
        [{"id": "a", "aandacht": "rood", "actie": "vervang", "voorstel_klasse": "Rechtssubject"}],
        CORPUS,
    )
    assert n.toegepast == 1
    assert uit[0]["klasse"] == "Rechtssubject"
    # Het oordeel ging over de vórige versie; de eindbeoordeling velt een nieuw oordeel.
    assert uit[0]["aandacht"] == "" and uit[0]["critic"] == ""


def test_vervang_tekst_alleen_als_die_letterlijk_in_de_bron_staat():
    """Een Critic die parafraseert corrigeert niets — dan zou code een verzinsel vastleggen."""
    instructie = {"id": "a", "aandacht": "rood", "actie": "vervang"}  # rood: wordt uitgevoerd
    goed, n_goed, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Voorwaarde", "tekst": "de schuldenaar"}],
        [{**instructie, "voorstel_tekst": "indien de schuldenaar daarom verzoekt"}],
        CORPUS,
    )
    assert (n_goed.toegepast, goed[0]["tekst"]) == (1, "indien de schuldenaar daarom verzoekt")

    mis, n_mis, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Voorwaarde", "tekst": "de schuldenaar"}],
        [{**instructie, "voorstel_tekst": "als de schuldenaar erom vraagt"}],
        CORPUS,
    )
    assert (n_mis.toegepast, mis[0]["tekst"]) == (0, "de schuldenaar")


@pytest.mark.parametrize("aandacht, blijft", [("rood", False), ("geel", True), ("groen", True)])
def test_verwijderen_alleen_bij_rood(aandacht, blijft):
    """De enige onomkeerbare handeling in de patcher — die vraagt het zwaarste oordeel."""
    uit, _, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger"}],
        [{"id": "a", "aandacht": aandacht, "actie": "verwijder"}],
        CORPUS,
    )
    assert bool(uit) is blijft


def test_een_markering_van_de_jurist_blijft_ongemoeid():
    """Een oordeel over eigen werk is een suggestie. Dat staat zo in de api en hoort hier niet
    alsnog stilletjes te worden doorgevoerd."""
    uit, n, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "van_jurist": True}],
        [{"id": "a", "aandacht": "rood", "actie": "vervang", "voorstel_klasse": "Rechtssubject"}],
        CORPUS,
    )
    assert n.toegepast == 0 and n.alternatief == 0 and uit[0]["klasse"] == "Rechtsfeit"


def test_geel_met_een_voorkeur_wordt_een_alternatief():
    """De Critic hoeft zijn voorkeur niet in te slikken, en er verandert niets op een vermoeden.

    De werkplek toont alternatieven als aanklikbare chip ("Twijfel — klik om te wisselen"), dus de
    jurist neemt hem met één klik over — en dan staat het als zíjn beslissing in het auditspoor.
    """
    uit, n, _rest = pas_critic_toe(
        # `aandacht`/`critic` staan er al op: critic_node zet ze vóór de patcher draait.
        [{"id": "a", "klasse": "Tijdsaanduiding", "tekst": "zes weken", "alternatieven": [],
          "aandacht": "geel", "critic": "kan ook een conditie zijn"}],
        [{"id": "a", "aandacht": "geel", "actie": "vervang", "voorstel_klasse": "Voorwaarde",
          "motivatie": "kan ook een conditie zijn"}],
        CORPUS,
    )
    assert (n.toegepast, n.alternatief) == (0, 1)
    assert uit[0]["klasse"] == "Tijdsaanduiding", "niets veranderd"
    assert uit[0]["alternatieven"] == [{"klasse": "Voorwaarde", "motivatie": "kan ook een conditie zijn"}]
    assert uit[0]["aandacht"] == "geel", "het oordeel blijft staan: er is niets herbeoordeeld"


def test_een_alternatief_dat_er_al_staat_komt_er_niet_twee_keer_bij():
    uit, n, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Tijdsaanduiding", "tekst": "zes weken",
          "alternatieven": [{"klasse": "Voorwaarde", "motivatie": "eerder al gezien"}]}],
        [{"id": "a", "aandacht": "geel", "actie": "vervang", "voorstel_klasse": "Voorwaarde"}],
        CORPUS,
    )
    assert n.alternatief == 0
    assert len(uit[0]["alternatieven"]) == 1


def test_geel_verandert_nooit_het_fragment():
    """Een fragmentwijziging kent geen 'alternatief'-vorm, dus bij twijfel gebeurt er niets."""
    uit, n, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Voorwaarde", "tekst": "de schuldenaar"}],
        [{"id": "a", "aandacht": "geel", "actie": "vervang",
          "voorstel_tekst": "indien de schuldenaar daarom verzoekt"}],
        CORPUS,
    )
    assert (n.toegepast, n.alternatief) == (0, 0)
    assert uit[0]["tekst"] == "de schuldenaar"


def test_afgehandelde_instructies_gaan_niet_door_naar_de_herziener():
    """Wat de patcher afhandelde, mag de herziener niet nóg eens uitvoeren.

    Dit ging live mis: de herziener kreeg de volledige feedback opnieuw, dus hij herhaalde de
    uitgevoerde correcties én voerde alsnog de gele voorkeuren uit die juist aan de jurist zouden
    worden voorgelegd. In de tijdlijn zag je dat als "2 aanwijzingen toegepast" gevolgd door
    "4 aangepast".
    """
    _uit, _n, rest = pas_critic_toe(
        [
            {"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger"},
            {"id": "b", "klasse": "Tijdsaanduiding", "tekst": "zes weken"},
            {"id": "c", "klasse": "Voorwaarde", "tekst": "de schuldenaar"},
        ],
        [
            {"id": "a", "aandacht": "rood", "actie": "vervang", "voorstel_klasse": "Rechtssubject"},
            {"id": "b", "aandacht": "geel", "actie": "vervang", "voorstel_klasse": "Voorwaarde"},
            {"id": "c", "aandacht": "rood", "actie": "vervang",
             "voorstel_tekst": "een fragment dat hier niet staat"},
        ],
        CORPUS,
    )
    # a is uitgevoerd, b is een alternatief geworden — allebei afgehandeld. Alleen c blijft over:
    # daar kan het model de brontekst lezen en het bedoelde fragment opzoeken.
    assert [f["id"] for f in rest] == ["c"]


def test_toepassen_staat_in_het_spoor():
    """"De Critic vroeg erom" is iets anders dan "het is ook gebeurd"."""
    uit, _, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "critic_rondes": [{"ronde": 1}]}],
        [{"id": "a", "aandacht": "rood", "actie": "vervang", "voorstel_klasse": "Rechtssubject"}],
        CORPUS,
    )
    assert uit[0]["critic_rondes"][-1]["toegepast"] is True


def test_behoud_laat_alles_staan():
    uit, n, _rest = pas_critic_toe(
        [{"id": "a", "klasse": "Rechtsfeit", "tekst": "De ontvanger", "aandacht": "geel"}],
        [{"id": "a", "aandacht": "geel", "actie": "behoud", "motivatie": "grensgeval"}],
        CORPUS,
    )
    assert n.toegepast == 0 and uit[0]["aandacht"] == "geel", "behoud verandert niets"


# --- de keten van begin tot eind ------------------------------------------------------------------

def test_de_correctie_gebeurt_zonder_herziening():
    """De kern: een `vervang` wordt door code uitgevoerd, niet door een tweede taalmodel.

    Vroeger kostte dit een herzieningscall met het volle corpus plus een nieuwe Critic-pas. Nu blijft
    alleen de eindbeoordeling over — en die gaat over de versie die de jurist te zien krijgt.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "dit is een subject",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert llm.index == NA_PATCH, "geen herziening: patch + eindbeoordeling"
    assert len(elementen) == 1
    assert elementen[0]["id"] == "el-a", "het id blijft; daar hangt het werk van de jurist aan"
    assert elementen[0]["klasse"] == "Rechtssubject"
    assert elementen[0]["aandacht"] == "groen"
    assert any("Correctie" in r for r in _statusregels(events))


def test_twijfel_belandt_als_alternatief_bij_de_jurist_zonder_extra_call():
    """Geel met een voorkeur verandert niets, dus er valt ook niets te herbeoordelen.

    Dit is de veelvoorkomende uitkomst: de Critic ziet een plausibel alternatief maar weet het niet
    zeker. Vroeger slikte hij die voorkeur in ("geel · behoud") en bleef de jurist met dezelfde vraag
    zitten; nu staat de klasse als aanklikbare chip op de kaart.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{**_EL, "klasse": "Tijdsaanduiding", "tekst": "De ontvanger"}]),
        _critic([{"id": "el-a", "aandacht": "geel", "motivatie": "kan ook een subject zijn",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert llm.index == SCHOON, "een alternatief is geen wijziging, dus geen eindbeoordeling"
    assert elementen[0]["klasse"] == "Tijdsaanduiding"
    assert [a["klasse"] for a in elementen[0]["alternatieven"]] == ["Rechtssubject"]
    assert elementen[0]["aandacht"] == "geel"
    assert any("alternatief" in r for r in _statusregels(events))


def test_een_schone_annotatie_kost_geen_extra_call():
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{**_EL, "klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "helder"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm)
    assert llm.index == SCHOON
    assert elementen[0]["aandacht"] == "groen"
    assert not any("Correctie" in r for r in _statusregels(events))


def test_geel_alleen_is_geen_correctie():
    """Geel is een aandachtspunt voor de jurist, geen opdracht aan de keten."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{**_EL, "klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "geel", "motivatie": "grensgeval", "actie": "behoud"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert llm.index == SCHOON
    assert elementen[0]["aandacht"] == "geel"


def test_een_onuitvoerbaar_voorstel_kost_geen_enkele_call():
    """Stelt de Critic een fragment voor dat niet in de bron staat, dan gebeurt er niets — en er valt
    ook niets te herzien, want er is geen verworpen fragment of gemist element."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{**_EL, "klasse": "Voorwaarde", "tekst": "De ontvanger"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "verkeerd fragment",
                  "actie": "vervang", "voorstel_tekst": "een fragment dat hier niet staat"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)
    assert llm.index == SCHOON
    assert elementen[0]["tekst"] == "De ontvanger"
    assert elementen[0]["aandacht"] == "rood", "het oordeel gaat mee naar de jurist"


def test_verworpen_fragment_lokt_nog_steeds_een_herziening_uit():
    """Een bijna-goed citaat repareren vraagt de brontekst lezen — dat blijft werk voor het model."""
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

    assert llm.index == NA_HERZIENING
    assert "indien de schuldenaar daarom verzoekt" in {e["tekst"] for e in elementen}
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
    assert llm.index == NA_HERZIENING
    assert {e["klasse"] for e in elementen} == {"Rechtssubject", "Voorwaarde"}


def test_de_keten_is_hard_begrensd():
    """Er is geen cyclus meer, dus er valt niets uit te putten: na de eindbeoordeling stopt het.

    De Critic blijft hier rood roepen met een nieuwe correctie; die tweede aanwijzing gaat naar de
    jurist in plaats van naar nóg een ronde.
    """
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Voorwaarde"}]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "nog steeds mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert llm.index == NA_PATCH, "de eindbeoordeling is het sluitstuk, geen nieuwe ingang"
    assert elementen[0]["klasse"] == "Voorwaarde", "alleen de eerste correctie is uitgevoerd"
    assert elementen[0]["aandacht"] == "rood", "het openstaande oordeel gaat mee naar de jurist"
    assert not any("rondelimiet" in r for r in _statusregels(events))


def test_klep_uit_reproduceert_het_oude_gedrag():
    """`CRITIC_MAX_RONDES=0`: geen patch, geen herziening — exact `annoteer → critic → emit`."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
    ])
    elementen, events = _annoteer_uitkomst(llm, critic_max_rondes=0)

    assert llm.index == SCHOON
    assert elementen[0]["klasse"] == "Rechtsfeit", "onaangeroerd"
    assert any("correctieronde uit" in r for r in _statusregels(events))


def test_gefaalde_critic_laat_de_voorstellen_staan():
    """De Critic mag de annotatie nooit breken; een fout stopt de keten, hij wist hem niet."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([{**_EL, "klasse": "Rechtssubject"}]),
        response([text_block("dit is geen JSON en ook geen oordeel")], "end_turn"),
    ])
    elementen, events = _annoteer_uitkomst(llm)

    assert len(elementen) == 1, "de voorstellen blijven staan"
    assert elementen[0]["aandacht"] == "", "geen oordeel, en dus ook geen verzonnen oordeel"
    assert llm.index == SCHOON


def test_elk_element_draagt_zijn_rondegeschiedenis():
    """Het spoor op de kaart: wat vond de Critic, en is het ook uitgevoerd?"""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "verkeerde klasse",
                  "actie": "vervang", "voorstel_klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "nu juist"}]),
    ])
    elementen, _ = _annoteer_uitkomst(llm)

    rondes = elementen[0]["critic_rondes"]
    assert [r["ronde"] for r in rondes] == [1, 2]
    assert rondes[0]["actie"] == "vervang" and rondes[0]["toegepast"] is True
    assert rondes[1]["aandacht"] == "groen" and rondes[1].get("toegepast") is False


def test_tweede_beurt_in_dezelfde_thread_begint_schoon(tmp_path):
    """De checkpointer bewaart de state per thread; zonder reset telt de tweede beurt door."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "goed"}]),
        *_aanloop(),
        _annoteer([{"id": "el-b", "klasse": "Rechtsfeit", "tekst": "verleent uitstel", "lid": "1"}]),
        _critic([{"id": "el-b", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtsbetrekking"}]),
        _critic([{"id": "el-b", "aandacht": "groen", "motivatie": "goed"}]),
    ])
    settings = make_settings(checkpoint_db_path=str(tmp_path / "cp.db"))
    graaf = FakeGraph(result=LID_TSV)
    for _ in range(2):
        _run(answer_stream("annoteer artikel 9 lid 1 van de Invorderingswet 1990",
                           conversation_id="g1", settings=settings, llm=llm, graph=graaf))

    assert llm.index == 2 * NA_PATCH, "de tweede beurt krijgt zijn eigen correctieronde"


def test_elke_statusregel_volgt_hetzelfde_idioom():
    """`Actor · wat er gebeurde` — één idioom, zodat de tijdlijn te lezen is als een verslag."""
    llm = FakeLLM([
        *_aanloop(),
        _annoteer([_EL]),
        _critic([{"id": "el-a", "aandacht": "rood", "motivatie": "mis", "actie": "vervang",
                  "voorstel_klasse": "Rechtssubject"}]),
        _critic([{"id": "el-a", "aandacht": "groen", "motivatie": "goed"}]),
    ])
    _, events = _annoteer_uitkomst(llm)
    for regel in _statusregels(events):
        assert " · " in regel, f"statusregel zonder scheiding: {regel!r}"
