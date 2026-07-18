"""Secrets via `*_FILE` (Docker host-bestand-conventie)."""
from __future__ import annotations

from agent.config import Settings


def test_secret_uit_file(tmp_path):
    f = tmp_path / "graphdb_token"
    f.write_text("  tok-uit-bestand\n", encoding="utf-8")
    s = Settings.from_env({"GRAPHDB_TOKEN_FILE": str(f)})
    assert s.graphdb_token == "tok-uit-bestand"  # gestript


def test_file_wint_van_env_var(tmp_path):
    f = tmp_path / "qa_api_token"
    f.write_text("uit-bestand", encoding="utf-8")
    s = Settings.from_env({"QA_API_TOKEN_FILE": str(f), "QA_API_TOKEN": "uit-env"})
    assert s.qa_api_token == "uit-bestand"


def test_env_var_zonder_file(tmp_path):
    s = Settings.from_env({"AZURE_FOUNDRY_API_KEY": "plain"})
    assert s.azure_foundry_api_key == "plain"


def test_ontbrekend_bestand_geeft_none(tmp_path):
    s = Settings.from_env({"GRAPHDB_TOKEN_FILE": str(tmp_path / "bestaat-niet")})
    assert s.graphdb_token is None
