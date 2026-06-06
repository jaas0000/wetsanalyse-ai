"""Tests voor de wetsanalyse webapp."""

import pytest

from app.models import (
    Activiteit2Data,
    Activiteit3Data,
    Afleidingsregel,
    Begrip,
    LidData,
    Markering,
)
from app.engine.rapport import genereer_rapport


# ── Rapport generatie ────────────────────────────────────────────────────────

def test_rapport_generatie():
    """Test dat rapportgeneratie een geldig Markdown-document oplevert."""

    a2 = Activiteit2Data(
        wet="Invorderingswet 1990",
        bwb_id="BWBR0004770",
        artikel="9",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0004770&artikel=9",
        leden=[
            LidData(lid="1", tekst="De invordering geschiedt door beslag te leggen op de in beslag genomen zaken."),
        ],
        markeringen=[
            Markering(
                id="m1",
                formulering="de invordering",
                klasse="Rechtsfeit",
                vindplaats="lid 1",
                toelichting="Actieve werkwoordsvorm: invordering",
            ),
            Markering(
                id="m2",
                formulering="beslag te leggen",
                klasse="Rechtsbetrekking",
                vindplaats="lid 1",
                toelichting="Werkwoordcombinatie duidend op plicht",
            ),
            Markering(
                id="m3",
                formulering="op de in beslag genomen zaken",
                klasse="Rechtsobject",
                vindplaats="lid 1",
                toelichting="Voorwerp van de betrekking",
            ),
        ],
        samenhang="De invordering (rechtsfeit) creëert de betrekking 'beslag leggen' op de in beslag genomen zaken.",
    )

    a3 = Activiteit3Data(
        wet="Invorderingswet 1990",
        bwb_id="BWBR0004770",
        artikel="9",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0004770&artikel=9",
        begrippen=[
            Begrip(
                id="b1",
                naam="invordering",
                klasse="Rechtsfeit",
                definitie="Het door de ontvanger verrichte handeling ter verhaal van de belastingschuld",
                voorbeeld="De ontvanger legt beslag op een bankrekening",
                kenmerken="rechtsfeit dat de rechtsbetrekking 'beslag' creëert",
                vindplaats="art. 9 lid 1",
                twijfel="",
            ),
        ],
        afleidingsregels=[
            Afleidingsregel(
                id="r1",
                naam="invordering door beslag",
                type="beslisregel",
                uitvoervariabele="invordering_geschiedt",
                invoervariabelen="belastingschuld, zaken_in_beslag",
                parameters="",
                voorwaarden="belastingschuld > 0",
                formulering="invordering_geschiedt := belastingschuld > 0 EN zaken_in_beslag",
                vindplaats="art. 9 lid 1",
                twijfel="",
            ),
        ],
        validatiepunten="De exacte voorwaarden voor invordering zijn niet in art. 9 lid 1 gespecificeerd; zie o.a. art. 10 e.v.",
    )

    rapport = genereer_rapport(
        wet="Invorderingswet 1990",
        bwb_id="BWBR0004770",
        artikel="9",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0004770&artikel=9",
        sectie="Artikel 9",
        pad="Hoofdstuk V > Afdeling 5.1 > Artikel 9",
        activiteit_2=a2,
        activiteit_3=a3,
    )

    # Basischecks
    assert "# Wetsanalyse" in rapport
    assert "Invorderingswet 1990" in rapport
    assert "## 0. Bron en afbakening" in rapport
    assert "## 1. Wettekst (letterlijk)" in rapport
    assert "## 2. Activiteit 2" in rapport
    assert "## 3. Activiteit 3" in rapport
    assert "## 4. Reviewlog" in rapport
    assert "BWBR0004770" in rapport
    assert "beslag te leggen" in rapport
    assert "invordering door beslag" in rapport
    assert "Hoofdstuk V > Afdeling 5.1 > Artikel 9" in rapport


def test_rapport_minimaal():
    """Test rapport met minimale data (geen markeringen, geen begrippen)."""

    a2 = Activiteit2Data(
        wet="Testwet",
        bwb_id="BWBR0000000",
        artikel="1",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0000000&artikel=1",
        leden=[LidData(lid="1", tekst="Dit is een testartikel.")],
        markeringen=[],
        samenhang="",
    )

    a3 = Activiteit3Data(
        wet="Testwet",
        bwb_id="BWBR0000000",
        artikel="1",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0000000&artikel=1",
        begrippen=[],
        afleidingsregels=[],
        validatiepunten="",
    )

    rapport = genereer_rapport(
        wet="Testwet",
        bwb_id="BWBR0000000",
        artikel="1",
        versiedatum="2026-01-01",
        bronreferentie="jci1.3:c:BWBR0000000&artikel=1",
        sectie=None,
        pad=None,
        activiteit_2=a2,
        activiteit_3=a3,
    )

    assert "# Wetsanalyse" in rapport
    assert "Testwet" in rapport
    assert "akkoord zonder wijzigingen" in rapport


# ── Analyse store ────────────────────────────────────────────────────────────

def test_analyse_store_roundtrip(tmp_path, monkeypatch):
    """Test dat een analyse opgeslagen en teruggelezen kan worden."""
    import app.engine.analyse_store as store
    test_db = str(tmp_path / "test.db")
    monkeypatch.setattr(store.settings, "database_path", test_db)

    # Init tabellen
    store.ensure_tables()

    analyse = {
        "id": "test123",
        "user_id": "testuser",
        "status": "review_2",
        "wet": "Testwet",
        "bwb_id": "BWBR0000000",
        "artikel": "1",
        "versiedatum": "2026-01-01",
        "bronreferentie": "jci1.3:c:BWBR0000000&artikel=1",
        "sectie": "Artikel 1",
        "pad": None,
        "activiteit_2": {"markeringen": [{"id": "m1", "formulering": "test", "klasse": "Rechtssubject", "vindplaats": "lid 1", "toelichting": ""}]},
        "activiteit_3": None,
        "review_feedback_2": "",
        "review_feedback_3": "",
        "rapport_md": "",
    }

    store.save_analyse(analyse)
    loaded = store.load_analyse("test123", "testuser")

    assert loaded is not None
    assert loaded["id"] == "test123"
    assert loaded["status"] == "review_2"
    assert loaded["wet"] == "Testwet"
    assert loaded["activiteit_2"]["markeringen"][0]["id"] == "m1"

    # Update en herlaad
    analyse["status"] = "klaar"
    analyse["rapport_md"] = "# Test rapport"
    store.save_analyse(analyse)

    loaded2 = store.load_analyse("test123", "testuser")
    assert loaded2["status"] == "klaar"
    assert loaded2["rapport_md"] == "# Test rapport"

    # Lijst
    analyses = store.list_analyses("testuser")
    assert len(analyses) == 1
    assert analyses[0]["id"] == "test123"

    # Verwijder
    assert store.delete_analyse("test123", "testuser") is True
    assert store.load_analyse("test123", "testuser") is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
