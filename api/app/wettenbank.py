"""MCP-client naar de wettenbank — deterministisch ophalen (stap 1), geen LLM-tool-calling.

De MCP geeft per tool één text-content-block terug waarvan de tekst een JSON-string is.
We parsen dat en geven een dict terug. Een lege of fout-respons werpt WettenbankError: de
brongetrouwheidseis verbiedt dat een MCP-mis stil tot lege context (en dus hallucinatie) leidt.
"""

from __future__ import annotations

import asyncio
import json

from .config import Settings


class WettenbankError(RuntimeError):
    """Ophalen mislukte of leverde niets — de job moet stoppen, niet doorgaan."""


class WettenbankClient:
    def __init__(self, settings: Settings) -> None:
        self.url = settings.mcp_url
        self.token = settings.mcp_token
        self.timeout = settings.mcp_timeout_s

    async def call(self, tool: str, args: dict) -> dict:
        try:
            return await asyncio.wait_for(self._call(tool, args), timeout=self.timeout)
        except asyncio.TimeoutError as e:
            raise WettenbankError(f"MCP-timeout op {tool} na {self.timeout}s") from e
        except WettenbankError:
            raise
        except Exception as e:  # noqa: BLE001 — alle transportfouten → WettenbankError
            raise WettenbankError(f"MCP-fout op {tool}: {e}") from e

    async def _call(self, tool: str, args: dict) -> dict:
        # Lazy import: de mcp-client is alleen nodig bij echt ophalen, niet in elke testopzet.
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        headers = {"Authorization": f"Bearer {self.token}"} if self.token else None
        async with streamablehttp_client(self.url, headers=headers) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, args)
                return self._parse(tool, result)

    @staticmethod
    def _parse(tool: str, result) -> dict:
        blocks = getattr(result, "content", None) or []
        teksten = [getattr(b, "text", "") for b in blocks if getattr(b, "type", "") == "text"]
        if not teksten:
            raise WettenbankError(f"MCP gaf geen tekst terug voor {tool}")
        try:
            data = json.loads(teksten[0])
        except json.JSONDecodeError as e:
            raise WettenbankError(f"MCP-respons voor {tool} is geen JSON: {e}") from e
        if isinstance(data, dict) and "fout" in data:
            raise WettenbankError(f"MCP-fout voor {tool}: {data['fout']}")
        return data

    # --- convenience ------------------------------------------------------

    async def artikel(self, bwb_id: str, artikel: str, lid: str | None = None) -> dict:
        args = {"bwbId": bwb_id, "artikel": artikel}
        if lid:
            args["lid"] = lid
        return await self.call("wettenbank_artikel", args)

    async def zoek(self, **kwargs) -> dict:
        return await self.call("wettenbank_zoek", kwargs)

    async def structuur(self, bwb_id: str) -> dict:
        return await self.call("wettenbank_structuur", {"bwbId": bwb_id})

    async def zoekterm(self, bwb_id: str, zoekterm: str, **kwargs) -> dict:
        return await self.call("wettenbank_zoekterm", {"bwbId": bwb_id, "zoekterm": zoekterm, **kwargs})


def map_artikel_naar_analyse_basis(artikel_data: dict) -> dict:
    """Map de MCP-artikelrespons naar de brongetrouwe basisvelden van analyse.json.

    Deze velden komen UIT de MCP en mogen niet door het LLM verzonnen worden.
    """
    leden = [
        {"lid": str(l.get("lid", "")), "tekst": l.get("tekst", "")}
        for l in (artikel_data.get("leden") or [])
    ]
    return {
        "wet": artikel_data.get("citeertitel", ""),
        "bwbId": artikel_data.get("bwbId", ""),
        "artikel": str(artikel_data.get("artikel", "")),
        "versiedatum": artikel_data.get("versiedatum", ""),
        "bronreferentie": artikel_data.get("bronreferentie", ""),
        "pad": artikel_data.get("pad", ""),
        "leden": leden,
    }
