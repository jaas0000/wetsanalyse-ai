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


def test_decompositie_defaults_uit():
    s = Settings.from_env({})
    assert s.enable_decomposition is False
    assert s.max_subquestions == 5


def test_decompositie_via_env():
    s = Settings.from_env({"ENABLE_DECOMPOSITION": "1", "MAX_SUBQUESTIONS": "3", "SUB_MAX_TURNS": "4"})
    assert s.enable_decomposition is True
    assert s.max_subquestions == 3
    assert s.sub_max_turns == 4


def test_lege_env_string_valt_terug_op_default():
    # L3: een gezet-maar-leeg env-var mag niet op int("")-coercie crashen maar de default nemen.
    s = Settings.from_env({"MAX_TURNS": "", "MAX_HISTORY_CHARS": "", "MAX_SUBQUESTIONS": ""})
    assert s.max_turns == 20
    assert s.max_history_chars == 40000
    assert s.max_subquestions == 5
