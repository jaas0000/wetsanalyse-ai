import { describe, it, expect } from "vitest";
import { leesClients, authenticeer, veiligGelijk } from "./auth.js";
describe("auth — leesClients", () => {
    it("parseert een id:token-lijst (komma-gescheiden)", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "a:tok1, b:tok2" });
        expect(clients).toEqual([
            { id: "a", token: "tok1" },
            { id: "b", token: "tok2" },
        ]);
    });
    it("parseert newline-gescheiden, negeert lege regels, kale regel = default", () => {
        const clients = leesClients({
            MCP_AUTH_TOKENS: "a:tok1\n\n  \nkaal\nb:tok2",
        });
        // Lege regels weg; 'kaal' is een kale token (id 'default').
        expect(clients.map((c) => c.id)).toEqual(["a", "default", "b"]);
    });
    it("ondersteunt tokens met een dubbele punt erin", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "a:pre:fix:tok" });
        expect(clients).toEqual([{ id: "a", token: "pre:fix:tok" }]);
    });
    it("accepteert een kale token in MCP_AUTH_TOKENS als clientId 'default' (backward-compat)", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "kaletoken" });
        expect(clients).toEqual([{ id: "default", token: "kaletoken" }]);
    });
    it("geeft meerdere kale tokens oplopende ids", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "tok1, tok2" });
        expect(clients).toEqual([
            { id: "default", token: "tok1" },
            { id: "client2", token: "tok2" },
        ]);
    });
    it("mengt kale en id:token-entries", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "kaal, jan:tok2" });
        expect(clients).toEqual([
            { id: "default", token: "kaal" },
            { id: "jan", token: "tok2" },
        ]);
    });
    it("voegt de legacy MCP_AUTH_TOKEN toe als clientId 'default'", () => {
        const clients = leesClients({ MCP_AUTH_TOKEN: "legacytok" });
        expect(clients).toEqual([{ id: "default", token: "legacytok" }]);
    });
    it("ontdubbelt op id (eerste wint)", () => {
        const clients = leesClients({ MCP_AUTH_TOKENS: "a:tok1, a:tok2" });
        expect(clients).toEqual([{ id: "a", token: "tok1" }]);
    });
    it("geeft lege lijst zonder configuratie", () => {
        expect(leesClients({})).toEqual([]);
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
