#!/usr/bin/env node
/**
 * Proxmox VE MCP-server (stdio) — READ-ONLY.
 *
 * Ontsluit de Proxmox VE-API (`/api2/json/*`) als agent-tools, zodat een MCP-client (Claude Code)
 * de hypervisor kan inspecteren: nodes, VM's/LXC's, hun config en status, snapshots, storage,
 * netwerk, taken en RRD-statistieken.
 *
 * Read-only is een eigenschap van de code, niet van de configuratie: er bestaat hier maar één
 * HTTP-helper (`pveGet`) en die doet uitsluitend GET. Er is geen code-pad dat POST/PUT/DELETE
 * uitvoert, dus geen tool kan iets starten, stoppen, wijzigen of verwijderen — ook niet bij een
 * ruim bemeten API-token. Wil je later power management, dan is dat een bewuste uitbreiding.
 *
 * Config via env (nooit in de repo):
 *   PROXMOX_URL           — basis-URL, bv. https://proxmox.ipalm.nl (zonder /api2/json)
 *   PROXMOX_TOKEN_ID      — token-id, bv. mcp@pve!claude
 *   PROXMOX_TOKEN_SECRET  — het secret dat `pveum user token add` eenmalig toonde
 *   PROXMOX_NODE          — optioneel; default-node als een tool er geen meekrijgt
 *
 * Fail-closed: zonder de eerste drie env-vars weigert de server te starten. Logs (JSON) gaan naar
 * stderr; het secret wordt nooit gelogd. stdout is exclusief voor het MCP-protocol.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.PROXMOX_URL ?? "").trim().replace(/\/+$/, "");
const TOKEN_ID = (process.env.PROXMOX_TOKEN_ID ?? "").trim();
const TOKEN_SECRET = (process.env.PROXMOX_TOKEN_SECRET ?? "").trim();
const DEFAULT_NODE = (process.env.PROXMOX_NODE ?? "").trim();

// ── Logging (JSON naar stderr; nooit secrets) ─────────────────────────────────

const GEHEIM = new Set(["authorization", "token", "secret", "password", "api_key", "ticket"]);

function log(niveau: "info" | "warn" | "error", bericht: string, velden: Record<string, unknown> = {}): void {
  const schoon: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(velden)) {
    if (GEHEIM.has(k.toLowerCase()) || v === undefined) continue;
    schoon[k] = v;
  }
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), niveau, bericht, ...schoon }) + "\n");
}

// ── API-client (uitsluitend GET — hier zit de read-only garantie) ─────────────

async function pveGet(path: string, query: Record<string, string | undefined> = {}): Promise<unknown> {
  const url = new URL(`${BASE_URL}/api2/json${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}` },
  });
  const tekst = await res.text();
  let data: unknown = tekst;
  try {
    data = tekst ? JSON.parse(tekst) : null;
  } catch {
    /* geen JSON — laat de ruwe tekst staan */
  }
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && data !== null && "errors" in data
        ? JSON.stringify((data as { errors: unknown }).errors)
        : tekst;
    const hint =
      res.status === 401
        ? " (controleer PROXMOX_TOKEN_ID/PROXMOX_TOKEN_SECRET)"
        : res.status === 403
          ? " (token mist rechten: pveum acl modify ... --token)"
          : "";
    throw new Error(`Proxmox ${res.status} op GET ${path}${hint}: ${String(detail).slice(0, 300)}`);
  }
  // PVE verpakt elk antwoord in {"data": ...}
  if (data && typeof data === "object" && data !== null && "data" in data) {
    return (data as { data: unknown }).data;
  }
  return data;
}

const seg = (s: string) => encodeURIComponent(s);

/**
 * Bepaalt de node voor een tool-aanroep: expliciet argument > PROXMOX_NODE > de enige node in het
 * cluster. Bij meerdere nodes zonder keuze volgt een duidelijke fout in plaats van een gok.
 */
let nodeCache: string[] | null = null;

async function bepaalNode(opgegeven?: unknown): Promise<string> {
  const expliciet = typeof opgegeven === "string" ? opgegeven.trim() : "";
  if (expliciet) return expliciet;
  if (DEFAULT_NODE) return DEFAULT_NODE;
  if (nodeCache === null) {
    const nodes = (await pveGet("/nodes")) as Array<{ node?: string }>;
    nodeCache = Array.isArray(nodes) ? nodes.map((n) => n.node ?? "").filter(Boolean) : [];
  }
  if (nodeCache.length === 1) return nodeCache[0]!;
  throw new Error(
    nodeCache.length === 0
      ? "Geen nodes gevonden; geef 'node' expliciet mee of zet PROXMOX_NODE."
      : `Meerdere nodes (${nodeCache.join(", ")}); geef 'node' mee of zet PROXMOX_NODE.`,
  );
}

// ── Tool-definities (declaratief) ─────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  run: (a: Record<string, unknown>) => Promise<unknown>;
}

const S = z.object;

const nodeArg = z.string().optional().describe("Nodenaam; leeg = PROXMOX_NODE of de enige node");
const guestType = z.enum(["qemu", "lxc"]).describe("qemu = VM, lxc = container");
const vmidArg = z.union([z.number().int(), z.string()]).describe("VMID van de VM of container");

const TOOLS: ToolDef[] = [
  // — cluster & nodes —
  {
    name: "get_version",
    description: "Proxmox VE-versie van de API. Handig als verbindings-/authenticatietest.",
    input: S({}),
    run: () => pveGet("/version"),
  },
  {
    name: "list_nodes",
    description: "Lijst de nodes in het cluster met status, uptime, CPU- en geheugengebruik.",
    input: S({}),
    run: () => pveGet("/nodes"),
  },
  {
    name: "get_cluster_status",
    description: "Clusterstatus: quorum, nodes en hun online-status.",
    input: S({}),
    run: () => pveGet("/cluster/status"),
  },
  {
    name: "list_resources",
    description:
      "Alle clusterresources in één overzicht. type filtert op vm (VM's én containers), storage, node of sdn.",
    input: S({ type: z.enum(["vm", "storage", "node", "sdn"]).optional() }),
    run: (a) => pveGet("/cluster/resources", { type: a.type as string | undefined }),
  },
  {
    name: "get_node_status",
    description: "Detailstatus van één node: CPU, geheugen, swap, uptime, kernel- en PVE-versie.",
    input: S({ node: nodeArg }),
    run: async (a) => pveGet(`/nodes/${seg(await bepaalNode(a.node))}/status`),
  },

  // — gasten (VM's en containers) —
  {
    name: "list_vms",
    description: "Lijst de QEMU-VM's op een node met hun status.",
    input: S({ node: nodeArg }),
    run: async (a) => pveGet(`/nodes/${seg(await bepaalNode(a.node))}/qemu`),
  },
  {
    name: "list_containers",
    description: "Lijst de LXC-containers op een node met hun status.",
    input: S({ node: nodeArg }),
    run: async (a) => pveGet(`/nodes/${seg(await bepaalNode(a.node))}/lxc`),
  },
  {
    name: "get_guest_status",
    description: "Huidige status van één VM of container: draaiend, uptime, CPU-, geheugen- en disk-gebruik.",
    input: S({ type: guestType, vmid: vmidArg, node: nodeArg }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/${a.type as string}/${seg(String(a.vmid))}/status/current`),
  },
  {
    name: "get_guest_config",
    description: "Configuratie van één VM of container: cores, geheugen, disks, netwerkinterfaces, boot-opties.",
    input: S({ type: guestType, vmid: vmidArg, node: nodeArg }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/${a.type as string}/${seg(String(a.vmid))}/config`),
  },
  {
    name: "list_snapshots",
    description: "Lijst de snapshots van één VM of container.",
    input: S({ type: guestType, vmid: vmidArg, node: nodeArg }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/${a.type as string}/${seg(String(a.vmid))}/snapshot`),
  },
  {
    name: "get_guest_rrddata",
    description:
      "Historische statistieken (CPU, geheugen, disk-, netwerk-I/O) van één VM of container over een tijdvenster.",
    input: S({
      type: guestType,
      vmid: vmidArg,
      timeframe: z.enum(["hour", "day", "week", "month", "year"]).optional(),
      node: nodeArg,
    }),
    run: async (a) =>
      pveGet(
        `/nodes/${seg(await bepaalNode(a.node))}/${a.type as string}/${seg(String(a.vmid))}/rrddata`,
        { timeframe: (a.timeframe as string) ?? "hour" },
      ),
  },

  // — storage —
  {
    name: "list_storage",
    description: "Lijst de storages op een node met type, capaciteit en vrije ruimte.",
    input: S({ node: nodeArg }),
    run: async (a) => pveGet(`/nodes/${seg(await bepaalNode(a.node))}/storage`),
  },
  {
    name: "list_storage_content",
    description:
      "Inhoud van één storage. content filtert op backup, images, iso, vztmpl, rootdir of snippets — bv. backup om te zien welke back-ups er staan.",
    input: S({
      storage: z.string(),
      content: z.enum(["backup", "images", "iso", "vztmpl", "rootdir", "snippets"]).optional(),
      node: nodeArg,
    }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/storage/${seg(a.storage as string)}/content`, {
        content: a.content as string | undefined,
      }),
  },

  // — netwerk —
  {
    name: "list_networks",
    description: "Netwerkinterfaces en bridges van een node.",
    input: S({ node: nodeArg }),
    run: async (a) => pveGet(`/nodes/${seg(await bepaalNode(a.node))}/network`),
  },

  // — taken —
  {
    name: "list_tasks",
    description: "Recente taken op een node (back-ups, migraties, starts). errors=true toont alleen mislukte taken.",
    input: S({
      limit: z.number().int().min(1).max(500).optional(),
      errors: z.boolean().optional(),
      node: nodeArg,
    }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/tasks`, {
        limit: String((a.limit as number) ?? 25),
        errors: a.errors === true ? "1" : undefined,
      }),
  },
  {
    name: "get_task_status",
    description: "Status van één taak via haar UPID (uit list_tasks).",
    input: S({ upid: z.string(), node: nodeArg }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/tasks/${seg(a.upid as string)}/status`),
  },
  {
    name: "get_task_log",
    description: "Logregels van één taak via haar UPID — de manier om een mislukte back-up of migratie te duiden.",
    input: S({ upid: z.string(), limit: z.number().int().min(1).max(1000).optional(), node: nodeArg }),
    run: async (a) =>
      pveGet(`/nodes/${seg(await bepaalNode(a.node))}/tasks/${seg(a.upid as string)}/log`, {
        limit: String((a.limit as number) ?? 100),
      }),
  },
];

// ── Server ────────────────────────────────────────────────────────────────────

function alsJsonSchema(schema: z.ZodType): { type: "object"; [k: string]: unknown } {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json["$schema"];
  return json as { type: "object"; [k: string]: unknown };
}

async function main(): Promise<void> {
  if (!BASE_URL || !TOKEN_ID || !TOKEN_SECRET) {
    log("error", "Weigering te starten: zet PROXMOX_URL, PROXMOX_TOKEN_ID en PROXMOX_TOKEN_SECRET.");
    process.exit(1);
  }
  if (!TOKEN_ID.includes("!")) {
    log("error", "PROXMOX_TOKEN_ID lijkt onvolledig: verwacht de vorm gebruiker@realm!tokennaam.");
    process.exit(1);
  }
  const server = new Server({ name: "proxmox", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: alsJsonSchema(t.input) })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = TOOLS.find((t) => t.name === req.params.name);
    if (!def) throw new Error(`Onbekende tool: ${req.params.name}`);
    const args = def.input.parse(req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const resultaat = await def.run(args);
      log("info", "tool ok", { tool: def.name });
      return { content: [{ type: "text", text: JSON.stringify(resultaat, null, 2) }] };
    } catch (e) {
      log("warn", "tool fout", { tool: def.name, fout: (e as Error).message });
      return { content: [{ type: "text", text: `Fout: ${(e as Error).message}` }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  log("info", "proxmox MCP gestart (stdio, read-only)", { base_url: BASE_URL, tools: TOOLS.length });
}

main().catch((e) => {
  log("error", "fatale startfout", { fout: (e as Error).message });
  process.exit(1);
});
