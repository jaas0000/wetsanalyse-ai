/**
 * Optionele OAuth2/OIDC-authenticatie voor het HTTP-transport.
 *
 * Reden (BIO2 / ISO 27002:2022 §8.5): federatieve authenticatie tegen de IdP van de
 * afnemer is het volwassen eindbeeld naast/voorbij statische bearer-tokens. Deze laag
 * valideert een binnenkomende JWT-bearer tegen een OIDC-issuer (signatuur via JWKS,
 * plus issuer/audience/exp/nbf-controle) en leidt de `clientId` af uit een claim.
 *
 * **Dormant tenzij geconfigureerd:** zonder `OIDC_ISSUER` retourneert de fabriek `null`
 * en blijft de statische/file-tokenauth de enige route.
 *
 * Configuratie (env):
 *   OIDC_ISSUER       — verplicht om OIDC aan te zetten, bijv. https://login.example.nl/realms/x
 *   OIDC_AUDIENCE     — verwachte audience; **verplicht** zodra OIDC_ISSUER is gezet.
 *                       Zonder audience-controle is elk token van de IdP (uitgegeven
 *                       voor wélke service dan ook) hier geldig — token-confusion.
 *   OIDC_JWKS_URI     — expliciet JWKS-endpoint (override); zonder deze wordt het
 *                       endpoint via OIDC-discovery bepaald:
 *                       `${issuer}/.well-known/openid-configuration` → `jwks_uri`
 *   OIDC_CLIENT_CLAIM — claim waaruit clientId komt; default `azp`, val terug op `sub`
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface OidcConfig {
  issuer: string;
  /** Expliciet JWKS-endpoint; indien afwezig wordt het via OIDC-discovery bepaald. */
  jwksUri?: string;
  audience: string;
  clientClaim: string;
}

/**
 * Lees de OIDC-config uit de omgeving; `null` = OIDC uit.
 * Gooit (fail-closed bij startup) als OIDC_ISSUER is gezet zonder OIDC_AUDIENCE.
 */
export function oidcConfigUitEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const audience = env.OIDC_AUDIENCE?.trim();
  if (!audience) {
    throw new Error(
      "OIDC_AUDIENCE is verplicht wanneer OIDC_ISSUER is gezet: zonder audience-controle " +
        "accepteert deze service ook tokens die de IdP voor een ándere service uitgaf " +
        "(token-confusion). Zet OIDC_AUDIENCE op de audience van deze MCP-server."
    );
  }
  return {
    issuer,
    jwksUri: env.OIDC_JWKS_URI?.trim() || undefined,
    audience,
    clientClaim: env.OIDC_CLIENT_CLAIM?.trim() || "azp",
  };
}

/** Injecteerbare fetch (tests); compatibel met de globale `fetch` én jose's customFetch. */
type FetchImpl = (url: string, options?: Parameters<typeof fetch>[1]) => Promise<Response>;

/**
 * Bepaal het JWKS-endpoint via OIDC-discovery (OpenID Connect Discovery 1.0 / RFC 8414):
 * `${issuer}/.well-known/openid-configuration` → veld `jwks_uri`. Het eerdere
 * default-pad `${issuer}/.well-known/jwks.json` was geen standaard en is verwijderd —
 * een expliciet endpoint kan via `OIDC_JWKS_URI`.
 */
export async function ontdekJwksUri(issuer: string, fetchImpl: FetchImpl = fetch): Promise<string> {
  const url = new URL(
    ".well-known/openid-configuration",
    issuer.endsWith("/") ? issuer : `${issuer}/`
  ).toString();
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`OIDC-discovery mislukt: HTTP ${res.status} van ${url}`);
  }
  const doc = (await res.json()) as { jwks_uri?: unknown };
  if (typeof doc.jwks_uri !== "string" || !doc.jwks_uri) {
    throw new Error(`OIDC-discovery: geen jwks_uri in ${url}`);
  }
  return doc.jwks_uri;
}

/** Resolver die een JWT-signeersleutel levert (jose `JWTVerifyGetKey` of een sleutel). */
type SleutelResolver = Parameters<typeof jwtVerify>[1];

export interface OidcVerifier {
  /** Valideer de bearer-header; retourneer clientId bij succes, anders null. */
  verifieer(authorizationHeader: string | undefined): Promise<string | null>;
}

/**
 * Bouw een OIDC-verifier. `sleutelResolver` is injecteerbaar voor tests; in productie
 * haalt hij de sleutels via JWKS (met caching) op van `config.jwksUri`, of — als die
 * ontbreekt — van het via OIDC-discovery gevonden endpoint.
 */
export function maakOidcVerifier(
  config: OidcConfig | null,
  sleutelResolver?: SleutelResolver,
  fetchImpl: FetchImpl = fetch
): OidcVerifier | null {
  if (!config) return null;
  const cfg = config;

  // Lazy + gecachet: discovery gebeurt hooguit één keer. Mislukt hij (IdP tijdelijk
  // onbereikbaar), dan wordt de cache geleegd zodat een volgend request het opnieuw
  // probeert — fail-closed, niet permanent kapot.
  let resolverPromise: Promise<SleutelResolver> | null = sleutelResolver
    ? Promise.resolve(sleutelResolver)
    : null;
  function haalResolver(): Promise<SleutelResolver> {
    if (!resolverPromise) {
      resolverPromise = (async () => {
        const uri = cfg.jwksUri ?? (await ontdekJwksUri(cfg.issuer, fetchImpl));
        return createRemoteJWKSet(new URL(uri)) as SleutelResolver;
      })();
      resolverPromise.catch(() => {
        resolverPromise = null;
      });
    }
    return resolverPromise;
  }

  return {
    async verifieer(header: string | undefined): Promise<string | null> {
      if (!header || !header.startsWith("Bearer ")) return null;
      const token = header.slice("Bearer ".length).trim();
      if (!token) return null;
      try {
        const resolver = await haalResolver();
        const { payload } = await jwtVerify(token, resolver, {
          issuer: cfg.issuer,
          audience: cfg.audience,
          // Pin asymmetrische algoritmes (defense-in-depth tegen alg-confusion/`none`).
          algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"],
        });
        const claim = payload[cfg.clientClaim];
        if (typeof claim === "string" && claim) return claim;
        if (typeof payload.sub === "string" && payload.sub) return payload.sub;
        return "oidc";
      } catch {
        // Ongeldige signatuur, verlopen, verkeerde issuer/audience, malformed → geweigerd.
        return null;
      }
    },
  };
}
