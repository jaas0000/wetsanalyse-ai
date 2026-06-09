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
 *   OIDC_JWKS_URI     — JWKS-endpoint; default `${issuer}/.well-known/jwks.json`
 *   OIDC_AUDIENCE     — verwachte audience (aanbevolen; anders niet afgedwongen)
 *   OIDC_CLIENT_CLAIM — claim waaruit clientId komt; default `azp`, val terug op `sub`
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface OidcConfig {
  issuer: string;
  jwksUri: string;
  audience?: string;
  clientClaim: string;
}

/** Lees de OIDC-config uit de omgeving; `null` = OIDC uit. */
export function oidcConfigUitEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const jwksUri =
    env.OIDC_JWKS_URI?.trim() ||
    new URL(".well-known/jwks.json", issuer.endsWith("/") ? issuer : `${issuer}/`).toString();
  return {
    issuer,
    jwksUri,
    audience: env.OIDC_AUDIENCE?.trim() || undefined,
    clientClaim: env.OIDC_CLIENT_CLAIM?.trim() || "azp",
  };
}

/** Resolver die een JWT-signeersleutel levert (jose `JWTVerifyGetKey` of een sleutel). */
type SleutelResolver = Parameters<typeof jwtVerify>[1];

export interface OidcVerifier {
  /** Valideer de bearer-header; retourneer clientId bij succes, anders null. */
  verifieer(authorizationHeader: string | undefined): Promise<string | null>;
}

/**
 * Bouw een OIDC-verifier. `sleutelResolver` is injecteerbaar voor tests; in productie
 * haalt hij de sleutels via JWKS (met caching) op uit `config.jwksUri`.
 */
export function maakOidcVerifier(
  config: OidcConfig | null,
  sleutelResolver?: SleutelResolver
): OidcVerifier | null {
  if (!config) return null;
  const resolver: SleutelResolver =
    sleutelResolver ?? createRemoteJWKSet(new URL(config.jwksUri));

  return {
    async verifieer(header: string | undefined): Promise<string | null> {
      if (!header || !header.startsWith("Bearer ")) return null;
      const token = header.slice("Bearer ".length).trim();
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, resolver, {
          issuer: config.issuer,
          audience: config.audience,
          // Pin asymmetrische algoritmes (defense-in-depth tegen alg-confusion/`none`).
          algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"],
        });
        const claim = payload[config.clientClaim];
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
