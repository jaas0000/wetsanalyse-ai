"""LiteLLM-implementatie van LLMClient.

Provider-prefix/auth komen uit de meegegeven `LlmConfig` (afgeleid uit een modelprofiel of de
env-fallback; Azure-endpointtype vastgesteld in Fase 0: `azure_ai/...` voor Foundry/MaaS,
`azure/...` voor Azure OpenAI). De echte JSON-garantie is niet de provider-feature maar deze
laag: schema verbatim in de prompt → parse → één gerichte repareer-retry → de caller valideert
tegen Pydantic.
"""

from __future__ import annotations

import json

from .base import LlmConfig, LLMError, LLMResult, parse_json_strict
from .throttle import llm_slot

_REPAREER = (
    "Je vorige antwoord was geen geldige JSON. Geef UITSLUITEND geldig JSON terug dat exact "
    "voldoet aan het gevraagde schema. Geen uitleg, geen markdown-fences."
)


class LiteLLMClient:
    def __init__(self, config: LlmConfig) -> None:
        self.c = config
        if not config.model:
            raise RuntimeError("LLM-model niet geconfigureerd (leeg in profiel én env).")

    def _model_ref(self) -> str:
        # LiteLLM verwacht "<provider>/<model>" tenzij het model al een prefix bevat.
        model = self.c.model
        if "/" in model:
            return model
        return f"{self.c.provider}/{model}"

    def _kwargs(self) -> dict:
        kw: dict = {"temperature": self.c.temperature}
        if self.c.api_base:
            kw["api_base"] = self.c.api_base
        if self.c.api_key:
            kw["api_key"] = self.c.api_key
        if self.c.api_version:  # alleen Azure OpenAI
            kw["api_version"] = self.c.api_version
        # json_object-strategie: laat de provider geldig JSON afdwingen waar dat kan.
        if self.c.output_strategy == "json_object":
            kw["response_format"] = {"type": "json_object"}
        return kw

    async def complete(self, system: str, user: str, schema: dict | None = None) -> LLMResult:
        import litellm

        schema_hint = ""
        if schema is not None:
            schema_hint = (
                "\n\nGeef je antwoord als JSON dat exact voldoet aan dit schema:\n"
                + json.dumps(schema, ensure_ascii=False, indent=2)
            )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user + schema_hint},
        ]

        # Eén completion (incl. de evt. repareer-retry) telt als één concurrency-slot: zo houdt de
        # globale rem het aantal gelijktijdige LLM-calls onder het plafond, ongeacht de repair.
        async with llm_slot():
            resp = await litellm.acompletion(model=self._model_ref(), messages=messages, **self._kwargs())
            tekst = resp.choices[0].message.content or ""
            usage = getattr(resp, "usage", None)

            try:
                data = parse_json_strict(tekst)
            except json.JSONDecodeError:
                # Eén gerichte repareer-retry.
                messages.append({"role": "assistant", "content": tekst})
                messages.append({"role": "user", "content": _REPAREER})
                resp = await litellm.acompletion(model=self._model_ref(), messages=messages, **self._kwargs())
                tekst = resp.choices[0].message.content or ""
                try:
                    data = parse_json_strict(tekst)
                except json.JSONDecodeError as e:
                    raise LLMError(f"Geen geldige JSON na reparatie: {e}") from e

        return LLMResult(
            data=data,
            model=getattr(resp, "model", self.c.model) or self.c.model,
            provider=self.c.provider,
            output_strategie=self.c.output_strategy,
            tokens_in=getattr(usage, "prompt_tokens", 0) or 0,
            tokens_out=getattr(usage, "completion_tokens", 0) or 0,
            ruwe_tekst=tekst,
        )


def build_llm_client(config: LlmConfig):
    """Factory — nu LiteLLM; uitbreidbaar naar andere adapters zonder de caller te raken."""
    return LiteLLMClient(config)
