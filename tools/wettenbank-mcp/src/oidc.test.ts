import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { oidcConfigUitEnv, maakOidcVerifier, ontdekJwksUri, type OidcConfig } from "./oidc.js";

const ISSUER = "https://idp.example.nl/";
const AUDIENCE = "wettenbank-mcp";

let priv: CryptoKey;
let pub: CryptoKey;

async function maakToken(opts: {
  issuer?: string;
  audience?: string;
  azp?: string;
  sub?: string;
  verlopen?: boolean;
} = {}): Promise<string> {
  const jwt = new SignJWT({ azp: opts.azp })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject(opts.sub ?? "user-1")
    .setExpirationTime(opts.verlopen ? "-1h" : "1h");
  if (opts.audience !== undefined) jwt.setAudience(opts.audience);
  else jwt.setAudience(AUDIENCE);
  return jwt.sign(priv);
}

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  priv = kp.privateKey;
  pub = kp.publicKey;
});

describe("oidc — config", () => {
  it("is uit zonder OIDC_ISSUER", () => {
    expect(oidcConfigUitEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("weigert te starten met OIDC_ISSUER zonder OIDC_AUDIENCE (token-confusion)", () => {
    expect(() =>
      oidcConfigUitEnv({ OIDC_ISSUER: "https://idp.example.nl" } as NodeJS.ProcessEnv)
    ).toThrow(/OIDC_AUDIENCE is verplicht/);
  });

  it("laat jwksUri leeg zonder OIDC_JWKS_URI (→ discovery) en defaultt clientClaim", () => {
    const cfg = oidcConfigUitEnv({
      OIDC_ISSUER: "https://idp.example.nl",
      OIDC_AUDIENCE: AUDIENCE,
    } as NodeJS.ProcessEnv);
    expect(cfg?.jwksUri).toBeUndefined();
    expect(cfg?.clientClaim).toBe("azp");
  });

  it("neemt expliciete jwksUri/audience/claim over", () => {
    const cfg = oidcConfigUitEnv({
      OIDC_ISSUER: "https://idp.example.nl",
      OIDC_JWKS_URI: "https://idp.example.nl/keys",
      OIDC_AUDIENCE: "aud-x",
      OIDC_CLIENT_CLAIM: "client_id",
    } as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({ jwksUri: "https://idp.example.nl/keys", audience: "aud-x", clientClaim: "client_id" });
  });
});

describe("oidc — verifier", () => {
  const cfg: OidcConfig = { issuer: ISSUER, jwksUri: "x", audience: AUDIENCE, clientClaim: "azp" };
  const maak = () => maakOidcVerifier(cfg, pub)!; // injecteer publieke sleutel als resolver

  it("fabriek geeft null als config null is", () => {
    expect(maakOidcVerifier(null)).toBeNull();
  });

  it("accepteert een geldig token en geeft clientId uit azp", async () => {
    const tok = await maakToken({ azp: "belastingdienst" });
    expect(await maak().verifieer(`Bearer ${tok}`)).toBe("belastingdienst");
  });

  it("valt terug op sub als de claim ontbreekt", async () => {
    const tok = await maakToken({ sub: "svc-account" });
    expect(await maak().verifieer(`Bearer ${tok}`)).toBe("svc-account");
  });

  it("weigert een verlopen token", async () => {
    const tok = await maakToken({ verlopen: true });
    expect(await maak().verifieer(`Bearer ${tok}`)).toBeNull();
  });

  it("weigert verkeerde issuer", async () => {
    const tok = await maakToken({ issuer: "https://evil.example/" });
    expect(await maak().verifieer(`Bearer ${tok}`)).toBeNull();
  });

  it("weigert verkeerde audience", async () => {
    const tok = await maakToken({ audience: "andere-aud" });
    expect(await maak().verifieer(`Bearer ${tok}`)).toBeNull();
  });

  it("weigert een ander-getekend token (verkeerde signatuur)", async () => {
    const ander = await generateKeyPair("RS256");
    const tok = await new SignJWT({ azp: "x" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("1h")
      .sign(ander.privateKey);
    expect(await maak().verifieer(`Bearer ${tok}`)).toBeNull();
  });

  it("weigert ontbrekende of niet-Bearer header", async () => {
    expect(await maak().verifieer(undefined)).toBeNull();
    expect(await maak().verifieer("Basic abc")).toBeNull();
    expect(await maak().verifieer("Bearer ")).toBeNull();
  });
});

describe("oidc — discovery", () => {
  const maakRespons = (body: unknown, ok = true, status = 200): Response =>
    ({ ok, status, json: async () => body } as unknown as Response);

  it("vindt jwks_uri via /.well-known/openid-configuration", async () => {
    const aanroepen: string[] = [];
    const fetchMock = (async (url: string) => {
      aanroepen.push(url);
      return maakRespons({ jwks_uri: "https://idp.example.nl/protocol/openid-connect/certs" });
    }) as never;
    const uri = await ontdekJwksUri("https://idp.example.nl", fetchMock);
    expect(aanroepen).toEqual(["https://idp.example.nl/.well-known/openid-configuration"]);
    expect(uri).toBe("https://idp.example.nl/protocol/openid-connect/certs");
  });

  it("faalt expliciet bij een HTTP-fout of ontbrekende jwks_uri", async () => {
    const fout = (async () => maakRespons({}, false, 503)) as never;
    await expect(ontdekJwksUri("https://idp.example.nl", fout)).rejects.toThrow(/HTTP 503/);
    const leeg = (async () => maakRespons({ geen: "jwks" })) as never;
    await expect(ontdekJwksUri("https://idp.example.nl", leeg)).rejects.toThrow(/geen jwks_uri/);
  });
});
