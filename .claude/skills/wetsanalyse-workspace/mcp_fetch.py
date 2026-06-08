#!/usr/bin/env python3
"""Kleine stdio-driver om de wettenbank-MCP rechtstreeks aan te roepen.

Gebruik:
  python mcp_fetch.py zoek '{"titel":"Wet op de zorgtoeslag"}'
  python mcp_fetch.py structuur '{"bwbId":"BWBR0018451"}'
  python mcp_fetch.py artikel '{"bwbId":"BWBR0018451","artikel":"2"}'
"""
import json
import subprocess
import sys

SERVER = "C:/Users/admin-willard/Documents/wetsanalyse-ai/tools/wettenbank-mcp/dist/index.js"
NODE   = "C:/Program Files/nodejs/node.exe"
TOOL = {
    "zoek": "wettenbank_zoek",
    "structuur": "wettenbank_structuur",
    "artikel": "wettenbank_artikel",
    "zoekterm": "wettenbank_zoekterm",
}


def main():
    tool = TOOL[sys.argv[1]]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    msgs = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                    "clientInfo": {"name": "fetch", "version": "1.0"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": tool, "arguments": args}},
    ]
    payload = "".join(json.dumps(m) + "\n" for m in msgs)
    proc = subprocess.run([NODE, SERVER], input=payload,
                          capture_output=True, text=True, timeout=60)
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == 2:
            content = msg["result"]["content"]
            for c in content:
                if c.get("type") == "text":
                    print(c["text"])
            return
    sys.stderr.write(proc.stderr)
    sys.exit("Geen resultaat ontvangen")


if __name__ == "__main__":
    main()
