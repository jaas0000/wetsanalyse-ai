"""Test-bootstrap: zet de projectroot op sys.path zodat `import app.*` werkt.

De brede engine-/durability-fixtures (FakeLLM/FakeWettenbank/store/engine) zijn met de
analyse-pijplijn verwijderd; de resterende suites (annotatie, auth, admin, wet-info,
validation, observability) brengen hun eigen fixtures mee."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
