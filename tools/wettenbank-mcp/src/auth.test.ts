import { describe, it, expect } from "vitest";
import { leesClients, authenticeer, veiligGelijk } from "./auth.js";

describe("auth — leesClients", () => {
  it("parseert een id:token-lijst (komma-gescheiden)", () => {
    const clients = leesClients({ MCP_AUTH_TOKENS: "a:tok1, b:tok2" } as NodeJS.ProcessEnv);
    expect(clients).toEqual([
      { id: "a", token: "tok1" },
      { id: "b", token: "tok2" },
    ]);
  });

  it("parseert newline-gescheiden en negeert lege/ongeldige regels", () => {
    const clients = leesClients({
      MCP_AUTH_TOKENS: "a:tok1\n\n  \nzonderdubbelepunt\nb:tok2",
    } as NodeJS.ProcessEnv);
    expect(clients.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ondersteunt tokens met een dubbele punt erin", () => {
    const clients = leesClients({ MCP_AUTH_TOKENS: "a:pre:fix:tok" } as NodeJS.ProcessEnv);
    expect(clients).toEqual([{ id: "a", token: "pre:fix:tok" }]);
  });

  it("voegt de legacy MCP_AUTH_TOKEN toe als clientId 'default'", () => {
    const clients = leesClients({ MCP_AUTH_TOKEN: "legacytok" } as NodeJS.ProcessEnv);
    expect(clients).toEqual([{ id: "default", token: "legacytok" }]);
  });

  it("ontdubbelt op id (eerste wint)", () => {
    const clients = leesClients({ MCP_AUTH_TOKENS: "a:tok1, a:tok2" } as NodeJS.ProcessEnv);
    expect(clients).toEqual([{ id: "a", token: "tok1" }]);
  });

  it("geeft lege lijst zonder configuratie", () => {
    expect(leesClients({} as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe("auth — authenticeer", () => {
  const clients = [
    { id: "a", token: "tok1" },
    { id: "b", token: "tok2" },
  ];

  it("geeft de clientId bij een correcte bearer-token", () => {
    expect(authenticeer("Bearer tok2", clients)).toBe("b");
  });

  it("geeft null bij onjuiste token", () => {
    expect(authenticeer("Bearer fout", clients)).toBeNull();
  });

  it("geeft null bij ontbrekende header", () => {
    expect(authenticeer(undefined, clients)).toBeNull();
  });

  it("eist het 'Bearer '-voorvoegsel (kale token werkt niet)", () => {
    expect(authenticeer("tok1", clients)).toBeNull();
  });
});

describe("auth — veiligGelijk", () => {
  it("true bij gelijke strings, false bij verschil of lengteverschil", () => {
    expect(veiligGelijk("abc", "abc")).toBe(true);
    expect(veiligGelijk("abc", "abd")).toBe(false);
    expect(veiligGelijk("abc", "abcd")).toBe(false);
  });
});
