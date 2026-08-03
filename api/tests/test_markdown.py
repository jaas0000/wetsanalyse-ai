"""Regressietests voor de Markdown-export, met nadruk op de vindplaats-weergave
(geen dubbele `lid lid`-prefix, geen redundant lid bij een bron op lid-niveau)."""

from app.markdown import _lid_suffix, rapport_naar_markdown


def test_lid_suffix_kaal_nummer():
    assert _lid_suffix("Wet art. 9.5", "1") == " lid 1"


def test_lid_suffix_geprefixte_waarde_niet_verdubbeld():
    # Data bevat "lid 1" i.p.v. "1"; mag geen "lid lid 1" worden.
    assert _lid_suffix("Wet art. 9.5", "lid 1") == " lid 1"


def test_lid_suffix_niet_herhaald_als_label_lid_bevat():
    assert _lid_suffix("Invorderingswet 1990 art. 9 lid 1", "lid 1") == ""
    assert _lid_suffix("Invorderingswet 1990 art. 9 lid 1", "1") == ""


def test_lid_suffix_leeg_bij_lid_loos_artikel():
    assert _lid_suffix("Leidraad Invordering 2008 art. 7a", "") == ""
    assert _lid_suffix("Leidraad Invordering 2008 art. 7a", None) == ""


def test_lid_suffix_verwart_artikelnummer_met_punt_niet():
    assert _lid_suffix("Leidraad Invordering 2008 art. 9.1", "1") == " lid 1"


def _rapport():
    return {
        "werkgebied": {"naam": "Invorderbaarheid"},
        "bronnen": [
            {"bron_id": "br1", "label": "Leidraad Invordering 2008 art. 9.5",
             "leden": [{"lid": "1", "tekst": "De betalingstermijn bedraagt zes weken."}],
             "markeringen": [{"id": "m1", "formulering": "betalingstermijn",
                              "klasse": "Object", "vindplaats": "lid 1"}]},
        ],
    }


def test_markdown_rendert_act2_rapport():
    md = rapport_naar_markdown(_rapport())
    assert "# Wetsanalyse — Invorderbaarheid" in md
    assert "betalingstermijn" in md
    # Act2-only: geen begrippen-/afleidingsregels-secties meer.
    assert "## 3." not in md
