"""BWB (wetstekst) client — haalt wettekst op via de MCP-server.

De MCP-server (TypeScript) wordt als subprocess gestart en via JSON-RPC
gecommuniceerd. Dit is dezelfde aanpak als mcp_fetch.py, maar dan
als persistente async client voor de webapp.

Voor productie kun je overwegen om de MCP-server als aparte container
te draaien met een HTTP-wrapper (zie docker-compose.yml).
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from app.models import (
    ArtikelResultaat,
    LidData,
    Regeling,
    ZoekResultaat,
)

logger = logging.getLogger(__name__)

# Pad naar de MCP-server binary
MCP_SERVER_PATH = Path(
    os.environ.get(
        "MCP_SERVER_PATH",
        str(
            Path(__file__).resolve().parent.parent.parent.parent
            / "tools"
            / "wettenbank-mcp"
            / "dist"
            / "index.js"
        )
    )
)


class McpError(Exception):
    """Fout van de MCP-server."""


# ── Helpers: MCP camelCase → Python snake_case ──────────────────────────────
# De MCP-server (TypeScript) retourneert camelCase; onze Pydantic-modellen
# gebruiken snake_case. Deze mappers vertalen de velden.

def _map_regeling(r: dict) -> Regeling:
    """Map een MCP-regeling dict (camelCase) naar een Regeling-model (snake_case)."""
    return Regeling(
        bwb_id=r.get("bwbId", ""),
        titel=r.get("titel", ""),
        type=r.get("type", ""),
        ministerie=r.get("ministerie", ""),
        rechtsgebied=r.get("rechtsgebied", ""),
        geldig_vanaf=r.get("geldigVanaf", ""),
        geldig_tot=r.get("geldigTot", ""),
        gewijzigd=r.get("gewijzigd", ""),
        repository_url=r.get("repositoryUrl", ""),
    )



class BwbClient:
    """Async client voor de wettenbank-MCP-server.

    Start de MCP-server als persistent subprocess en communiceert via
    JSON-RPC over stdin/stdout. Bij crash wordt automatisch gereconnect.
    """

    def __init__(self):
        self._proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._request_id = 0
        self._started = False

    async def start(self):
        """Start de MCP-server als subprocess."""
        if self._started and self._proc is not None and self._proc.returncode is None:
            return

        if not MCP_SERVER_PATH.exists():
            raise McpError(
                f"MCP-server niet gevonden: {MCP_SERVER_PATH}. "
                "Bouw eerst: cd tools/wettenbank-mcp && npm run build"
            )

        self._proc = await asyncio.create_subprocess_exec(
            "node",
            str(MCP_SERVER_PATH),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Initialiseer de MCP-verbinding
        await self._rpc_call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "wetsanalyse-webapp", "version": "1.0"},
        })
        # Stuur initialized notification
        await self._rpc_notify("notifications/initialized")

        self._started = True
        logger.info("MCP-server gestart (pid=%s)", self._proc.pid)

    async def _ensure_alive(self):
        """Zorg dat de MCP-server draait; reconnect indien nodig."""
        if self._proc is not None and self._proc.returncode is None:
            return
        logger.warning("MCP-server gestopt (returncode=%s), reconnect...", self._proc.returncode if self._proc else "N/A")
        self._started = False
        self._proc = None
        self._request_id = 0
        await self.start()

    async def stop(self):
        """Stop de MCP-server."""
        if self._proc is None:
            return
        try:
            self._proc.terminate()
            await asyncio.wait_for(self._proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            self._proc.kill()
        self._proc = None
        self._started = False
        logger.info("MCP-server gestopt")

    async def _rpc_call(self, method: str, params: dict | None = None) -> Any:
        """Stuur een JSON-RPC call en wacht op het antwoord."""
        async with self._lock:
            await self._ensure_alive()

            if self._proc is None or self._proc.stdin is None:
                raise McpError("MCP-server niet gestart")

            self._request_id += 1
            req_id = self._request_id

            msg = {"jsonrpc": "2.0", "id": req_id, "method": method}
            if params:
                msg["params"] = params

            line = json.dumps(msg) + "\n"
            self._proc.stdin.write(line.encode())
            await self._proc.stdin.drain()

            # Wacht op het antwoord met matching id
            while True:
                raw = await asyncio.wait_for(
                    self._proc.stdout.readline(), timeout=30
                )
                if not raw:
                    raise McpError("MCP-server gestopt onverwacht")
                try:
                    response = json.loads(raw.decode())
                except json.JSONDecodeError:
                    continue
                if response.get("id") == req_id:
                    if "error" in response:
                        raise McpError(response["error"].get("message", "onbekende MCP-fout"))
                    return response.get("result")

    async def _rpc_notify(self, method: str, params: dict | None = None):
        """Stuur een JSON-RPC notification (geen antwoord verwacht)."""
        if self._proc is None or self._proc.stdin is None:
            return

        msg = {"jsonrpc": "2.0", "method": method}
        if params:
            msg["params"] = params

        line = json.dumps(msg) + "\n"
        self._proc.stdin.write(line.encode())
        await self._proc.stdin.drain()

    async def zoek(
        self,
        titel: str | None = None,
        rechtsgebied: str | None = None,
        ministerie: str | None = None,
        regelingsoort: str | None = None,
        max_resultaten: int = 10,
        peildatum: str | None = None,
    ) -> ZoekResultaat:
        """Zoek regelingen op naam/type/ministerie."""
        args: dict[str, Any] = {"maxResultaten": max_resultaten}
        if titel:
            args["titel"] = titel
        if rechtsgebied:
            args["rechtsgebied"] = rechtsgebied
        if ministerie:
            args["ministerie"] = ministerie
        if regelingsoort:
            args["regelingsoort"] = regelingsoort
        if peildatum:
            args["peildatum"] = peildatum

        result = await self._rpc_call("tools/call", {
            "name": "wettenbank_zoek",
            "arguments": args,
        })

        # MCP retourneert JSON als string in content[0].text
        # De MCP-server gebruikt camelCase; onze modellen gebruiken snake_case
        text = result["content"][0]["text"]
        data = json.loads(text)

        return ZoekResultaat(
            totaal=data["totaal"],
            regelingen=[_map_regeling(r) for r in data["regelingen"]],
        )

    async def artikel(
        self,
        bwb_id: str,
        artikel: str,
        lid: str | None = None,
        peildatum: str | None = None,
    ) -> ArtikelResultaat:
        """Haal een artikel op."""
        args: dict[str, Any] = {"bwbId": bwb_id, "artikel": artikel}
        if lid:
            args["lid"] = lid
        if peildatum:
            args["peildatum"] = peildatum

        result = await self._rpc_call("tools/call", {
            "name": "wettenbank_artikel",
            "arguments": args,
        })

        text = result["content"][0]["text"]
        data = json.loads(text)

        if "fout" in data:
            raise McpError(data["fout"])

        return ArtikelResultaat(
            formaat=data["formaat"],
            citeertitel=data["citeertitel"],
            versiedatum=data["versiedatum"],
            bwb_id=data.get("bwbId") or data.get("bwb_id", ""),
            artikel=data["artikel"],
            lid=data.get("lid"),
            sectie=data.get("sectie"),
            pad=data.get("pad"),
            leden=[LidData(lid=lid_data["lid"], tekst=lid_data["tekst"]) for lid_data in data["leden"]],
            bronreferentie=data["bronreferentie"],
        )

    async def zoekterm(
        self,
        bwb_id: str,
        zoekterm: str,
        peildatum: str | None = None,
        max_resultaten: int = 10,
        includeer_tekst: bool = False,
    ) -> dict:
        """Zoek binnen een wet naar een term."""
        args: dict[str, Any] = {
            "bwbId": bwb_id,
            "zoekterm": zoekterm,
            "maxResultaten": max_resultaten,
            "includeerTekst": includeer_tekst,
        }
        if peildatum:
            args["peildatum"] = peildatum

        result = await self._rpc_call("tools/call", {
            "name": "wettenbank_zoekterm",
            "arguments": args,
        })

        text = result["content"][0]["text"]
        return json.loads(text)


# Singleton client + lock
_client: BwbClient | None = None
_client_lock = asyncio.Lock()


async def get_client() -> BwbClient:
    """Haal de globale BwbClient (start indien nodig)."""
    global _client
    async with _client_lock:
        if _client is None:
            _client = BwbClient()
            await _client.start()
    return _client


async def close_client():
    """Sluit de globale BwbClient."""
    global _client
    async with _client_lock:
        if _client is not None:
            await _client.stop()
            _client = None
