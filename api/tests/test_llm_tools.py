"""Tests voor de agent⇄tools-loop in de LLM-laag (`LiteLLMClient.run_tools`).

Stubt `litellm` in sys.modules (zoals test_llm_resilience) zodat er geen provider nodig is."""

from __future__ import annotations

import sys
import types

import pytest

from app.llm.base import LlmConfig
from app.llm.litellm_client import LiteLLMClient


class _Fn:
    def __init__(self, name, args):
        self.name = name
        self.arguments = args


class _ToolCall:
    def __init__(self, cid, name, args):
        self.id = cid
        self.function = _Fn(name, args)


class _Msg:
    # Bewust géén model_dump → oefent de handmatige _bericht_dict-tak.
    def __init__(self, content="", tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []


class _Usage:
    def __init__(self, i, o):
        self.prompt_tokens = i
        self.completion_tokens = o


class _Resp:
    def __init__(self, msg, i, o):
        self.choices = [type("C", (), {"message": msg})()]
        self.usage = _Usage(i, o)
        self.model = "fake/model"


def _stub_litellm(monkeypatch, responses):
    it = iter(responses)

    async def fake_acompletion(**kwargs):
        return next(it)

    stub = types.ModuleType("litellm")
    stub.acompletion = fake_acompletion
    monkeypatch.setitem(sys.modules, "litellm", stub)


async def test_run_tools_voert_tool_uit_en_eindigt(monkeypatch):
    _stub_litellm(monkeypatch, [
        _Resp(_Msg(tool_calls=[_ToolCall("c1", "haal_bepaling", '{"bwbId": "BWBR1", "artikel": "1"}')]), 10, 3),
        _Resp(_Msg(content="klaar"), 20, 7),
    ])
    client = LiteLLMClient(LlmConfig(model="fake/model", max_prompt_tokens=1_000_000))

    geroepen = []

    async def execute(naam, args):
        geroepen.append((naam, args))
        return "lid 1: De belastingplichtige doet aangifte."

    res = await client.run_tools("sys", "user", tools=[{"type": "function"}], execute=execute)

    assert geroepen == [("haal_bepaling", {"bwbId": "BWBR1", "artikel": "1"})]
    assert res.ruwe_tekst == "klaar"
    assert res.tokens_in == 30 and res.tokens_out == 10   # gesommeerd over beide beurten


async def test_run_tools_respecteert_max_iters(monkeypatch):
    # Het model blijft een tool aanroepen; de loop stopt na max_iters (geen oneindige lus).
    tool_resp = lambda: _Resp(_Msg(tool_calls=[_ToolCall("c", "haal_bepaling", "{}")]), 1, 1)
    _stub_litellm(monkeypatch, [tool_resp() for _ in range(10)])
    client = LiteLLMClient(LlmConfig(model="fake/model", max_prompt_tokens=1_000_000))

    n = 0

    async def execute(naam, args):
        nonlocal n
        n += 1
        return "x"

    res = await client.run_tools("s", "u", tools=[{"type": "function"}], execute=execute, max_iters=3)
    assert n == 3            # precies max_iters tool-beurten
    assert res.ruwe_tekst == ""


async def test_run_tools_slechte_args_worden_leeg(monkeypatch):
    _stub_litellm(monkeypatch, [
        _Resp(_Msg(tool_calls=[_ToolCall("c1", "t", "dit is geen json")]), 1, 1),
        _Resp(_Msg(content="ok"), 1, 1),
    ])
    client = LiteLLMClient(LlmConfig(model="fake/model", max_prompt_tokens=1_000_000))
    gezien = []

    async def execute(naam, args):
        gezien.append(args)
        return ""

    await client.run_tools("s", "u", tools=[{"type": "function"}], execute=execute)
    assert gezien == [{}]    # onparseerbare arguments → lege dict, geen crash
