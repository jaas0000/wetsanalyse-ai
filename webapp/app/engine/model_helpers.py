"""Helper functions om raw dicts uit de database te reconstrueren als Pydantic modellen.

De database slaat Activiteit2Data en Activiteit3Data als JSON op. Bij uitlezing
krijgen we dicts terug die geneste dicts bevatten i.p.v. Pydantic instances.
Deze helpers zetten die dicts om in de juiste Pydantic objecten.
"""

from app.models import (
    Activiteit2Data,
    Activiteit3Data,
    Afleidingsregel,
    Begrip,
    LidData,
    Markering,
)


def reconstruct_activiteit_2(data) -> Activiteit2Data:
    """Reconstrueer een Activiteit2Data uit een raw dict (uit de database).

    Als *data* al een Activiteit2Data is, wordt het teruggegeven zoals-het-is.
    """
    if not isinstance(data, dict):
        return data
    converted = dict(data)
    converted["markeringen"] = [
        Markering(**m) if isinstance(m, dict) else m
        for m in data.get("markeringen", [])
    ]
    converted["leden"] = [
        LidData(**lid) if isinstance(lid, dict) else lid
        for lid in data.get("leden", [])
    ]
    return Activiteit2Data(**converted)


def reconstruct_activiteit_3(data) -> Activiteit3Data:
    """Reconstrueer een Activiteit3Data uit een raw dict (uit de database).

    Als *data* al een Activiteit3Data is, wordt het teruggegeven zoals-het-is.
    """
    if not isinstance(data, dict):
        return data
    converted = dict(data)
    converted["begrippen"] = [
        Begrip(**b) if isinstance(b, dict) else b
        for b in data.get("begrippen", [])
    ]
    converted["afleidingsregels"] = [
        Afleidingsregel(**r) if isinstance(r, dict) else r
        for r in data.get("afleidingsregels", [])
    ]
    return Activiteit3Data(**converted)
