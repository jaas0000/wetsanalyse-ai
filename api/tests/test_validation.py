from app.validation import (
    GELDIGE_JAS_KLASSEN,
    brongetrouwheid_check,
    normaliseer,
    schema_check,
)


def test_jas_klassen_canoniek():
    assert "Rechtssubject" in GELDIGE_JAS_KLASSEN
    assert len(GELDIGE_JAS_KLASSEN) == 13


def test_schema_check_delegatie_ongeldige_klasse():
    data = {"bronreferentie": "jci:x", "leden": [], "markeringen": [{"id": "m1", "klasse": "Verzonnen"}]}
    fouten, _ = schema_check(data, "2")
    assert any("Ongeldige JAS-klasse" in f for f in fouten)


def test_brongetrouwheid_citaat_normalisatie():
    leden = [{"lid": "1", "tekst": "De  belastingplichtige doet “aangifte”."}]
    # zelfde citaat met rechte quotes en enkele spatie → moet als letterlijk gelden
    ok = {"bronreferentie": "jci:x", "leden": leden,
          "markeringen": [{"id": "m1", "formulering": 'De belastingplichtige doet "aangifte".',
                           "vindplaats": "lid 1"}]}
    assert brongetrouwheid_check(ok, "2") == []

    verzonnen = {"bronreferentie": "jci:x", "leden": leden,
                 "markeringen": [{"id": "m1", "formulering": "iets dat er niet staat",
                                  "vindplaats": "lid 1"}]}
    schend = brongetrouwheid_check(verzonnen, "2")
    assert any("letterlijk citaat" in s for s in schend)


def test_brongetrouwheid_bronreferentie_en_vindplaats_verplicht():
    schend = brongetrouwheid_check({"leden": [], "markeringen": [{"id": "m1", "formulering": ""}]}, "2")
    assert any("bronreferentie" in s for s in schend)
    assert any("vindplaats" in s for s in schend)


def test_normaliseer():
    assert normaliseer("  A’B  \n c ") == "a'b c"
