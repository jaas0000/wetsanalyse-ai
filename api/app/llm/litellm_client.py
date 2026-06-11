"""LiteLLM-implementatie van LLMClient.

Provider-prefix/auth komen uit de config (Azure-endpointtype vastgesteld in Fase 0:
`azure_ai/...` voor Foundry/MaaS, `azure/...` voor Azure OpenAI). De echte JSON-garantie is
niet de provider-feature maar deze laag: schema verbatim in de prompt → parse → één gerichte
repareer-retry → de caller valideert tegen Pydantic.
"""

from __future__ import annotations

import json

from ..config import Settings
from .base import LLMError, LLMResult, parse_json_strict

_REPAREER = (
    "Je vorige antwoord was geen geldige JSON. Geef UITSLUITEND geldig JSON terug dat exact "
    "voldoet aan het gevraagde schema. Geen uitleg, geen markdown-fences."
)


class LiteLLMClient:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        if not settings.llm_model:
            raise RuntimeError("LLM_MODEL niet geconfigureerd.")

    def _model_ref(self) -> str:
        # LiteLLM verwacht "<provider>/<model>" tenzij het model al een prefix bevat.
        model = self.s.llm_model
        if "/" in model:
            return model
        return f"{self.s.llm_provider}/{model}"

    def _kwargs(self) -> dict:
        kw: dict = {"temperature": self.s.llm_temperature}
        if self.s.llm_api_base:
            kw["api_base"] = self.s.llm_api_base
        if self.s.llm_api_key:
            kw["api_key"] = self.s.llm_api_key
        if self.s.llm_api_version:  # alleen Azure OpenAI
            kw["api_version"] = self.s.llm_api_version
        # json_object-strategie: laat de provider geldig JSON afdwingen waar dat kan.
        if self.s.llm_output_strategy == "json_object":
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
            model=getattr(resp, "model", self.s.llm_model) or self.s.llm_model,
            provider=self.s.llm_provider,
            output_strategie=self.s.llm_output_strategy,
            tokens_in=getattr(usage, "prompt_tokens", 0) or 0,
            tokens_out=getattr(usage, "completion_tokens", 0) or 0,
            ruwe_tekst=tekst,
        )


def build_llm_client(settings: Settings):
    """Factory — nu LiteLLM; uitbreidbaar naar andere adapters zonder de caller te raken."""
    return LiteLLMClient(settings)
