/**
 * In-memory rate limiting (token-bucket) voor het HTTP-transport.
 *
 * Reden (BIO2 / ISO 27002:2022, 8.6 capaciteitsbeheer + beschikbaarheid): zonder
 * begrenzing kan één client de SRU-bron en deze service overbelasten, en is
 * brute-force op de bearer-token ongelimiteerd. Een token-bucket staat bursts toe
 * tot `capaciteit` en vult daarna met `perSeconde` tokens aan.
 *
 * Sleutel = client-IP (uit X-Forwarded-For achter de proxy), zodat ook
 * niet-geauthenticeerde pogingen begrensd zijn. IPv6-adressen worden op hun
 * /64-prefix gebucket (één host krijgt standaard een heel /64 toegewezen, dus
 * per-adres limiteren is daar triviaal te omzeilen). Alleen Node-stdlib.
 *
 * Naast de per-IP-limiter draait ná de auth een tweede, ruimere limiter per
 * geauthenticeerde `clientId` (zie http-server.ts), zodat één afnemer achter een
 * gedeeld proxy-IP de bron niet alsnog kan overbelasten.
 *
 * Configuratie (env):
 *   MCP_RATE_BURST          — emmergrootte / max. burst per IP (default 60)
 *   MCP_RATE_PER_MIN        — aanvulsnelheid per IP per minuut (default 120)
 *   MCP_RATE_CLIENT_BURST   — emmergrootte per clientId (default 120)
 *   MCP_RATE_CLIENT_PER_MIN — aanvulsnelheid per clientId per minuut (default 300)
 */

import { isIPv6 } from "node:net";

interface Emmer {
  tokens: number;
  laatst: number; // ms timestamp van laatste aanvulling
}

export interface RateLimiter {
  /** Probeer één token te claimen voor `sleutel`. true = toegestaan. */
  staToe(sleutel: string): boolean;
  /** Aantal actieve emmers (voor tests/monitoring). */
  omvang(): number;
  /** Stop de opruim-timer (voor nette afsluiting/tests). */
  stop(): void;
}

export interface RateLimiterOpties {
  capaciteit: number;
  perSeconde: number;
  /** Emmers die langer dan dit ongebruikt zijn, worden opgeruimd (ms). */
  idleMs?: number;
  /** Hard plafond op het aantal emmers (default 10.000); daarboven wordt de
   *  langst-ongebruikte emmer geëvict. Voorkomt geheugengroei door een aanvaller
   *  die sleutels spamt (bv. een heel IPv6-blok afloopt) sneller dan de
   *  idle-opruiming bijhoudt. */
  maxEmmers?: number;
}

/** Lees de per-IP-limiter-config uit de omgeving. */
export function leesRateConfig(env: NodeJS.ProcessEnv = process.env): RateLimiterOpties {
  const capaciteit = Number(env.MCP_RATE_BURST ?? 60);
  const perMinuut = Number(env.MCP_RATE_PER_MIN ?? 120);
  return {
    capaciteit: capaciteit > 0 ? capaciteit : 60,
    perSeconde: perMinuut > 0 ? perMinuut / 60 : 2,
  };
}

/**
 * Lees de per-client-limiter-config uit de omgeving (toegepast ná auth, sleutel =
 * clientId). Bewust ruimer dan de per-IP-limiet: meerdere gebruikers van één afnemer
 * kunnen achter hetzelfde token zitten.
 */
export function leesClientRateConfig(env: NodeJS.ProcessEnv = process.env): RateLimiterOpties {
  const capaciteit = Number(env.MCP_RATE_CLIENT_BURST ?? 120);
  const perMinuut = Number(env.MCP_RATE_CLIENT_PER_MIN ?? 300);
  return {
    capaciteit: capaciteit > 0 ? capaciteit : 120,
    perSeconde: perMinuut > 0 ? perMinuut / 60 : 5,
  };
}

/**
 * Normaliseer een IP naar zijn rate-limit-sleutel. IPv6 wordt teruggebracht tot de
 * /64-prefix (de kleinste toewijzing die een eindgebruiker doorgaans krijgt — per
 * adres limiteren is binnen een /64 gratis te omzeilen). IPv4 en IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`) blijven per adres. Pure functie (testbaar).
 */
export function normaliseerIpSleutel(ip: string): string {
  // IPv4-mapped IPv6 is feitelijk IPv4 → strip de prefix en bucket per adres.
  const kaal = ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip;
  if (!kaal.includes(":") || !isIPv6(kaal)) return kaal;
  // Expandeer een eventuele "::" en neem de eerste 4 hextets (= /64-prefix).
  const delen = kaal.toLowerCase().split("::");
  let hextets: string[];
  if (delen.length === 2) {
    const links = delen[0] ? delen[0].split(":") : [];
    const rechts = delen[1] ? delen[1].split(":") : [];
    hextets = [...links, ...Array(8 - links.length - rechts.length).fill("0"), ...rechts];
  } else {
    hextets = kaal.toLowerCase().split(":");
  }
  // Leidende nullen weg ("0db8" → "db8") zodat varianten van hetzelfde adres
  // dezelfde sleutel opleveren.
  return `${hextets.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function maakRateLimiter(opts: RateLimiterOpties): RateLimiter {
  const { capaciteit, perSeconde } = opts;
  const idleMs = opts.idleMs ?? 10 * 60 * 1000;
  const maxEmmers = opts.maxEmmers ?? 10_000;
  const emmers = new Map<string, Emmer>();

  /** Evict de langst-ongebruikte emmer (laagste `laatst`) als het plafond is bereikt. */
  function evictOudste(): void {
    let oudsteSleutel: string | undefined;
    let oudste = Infinity;
    for (const [sleutel, emmer] of emmers) {
      if (emmer.laatst < oudste) {
        oudste = emmer.laatst;
        oudsteSleutel = sleutel;
      }
    }
    if (oudsteSleutel !== undefined) emmers.delete(oudsteSleutel);
  }

  function vulAan(emmer: Emmer, nu: number): void {
    const verstreken = (nu - emmer.laatst) / 1000;
    if (verstreken > 0) {
      emmer.tokens = Math.min(capaciteit, emmer.tokens + verstreken * perSeconde);
      emmer.laatst = nu;
    }
  }

  // Periodiek lege/oude emmers opruimen zodat de Map niet onbegrensd groeit.
  const opruim = setInterval(() => {
    const nu = Date.now();
    for (const [sleutel, emmer] of emmers) {
      if (nu - emmer.laatst > idleMs) emmers.delete(sleutel);
    }
  }, Math.min(idleMs, 5 * 60 * 1000));
  opruim.unref();

  return {
    staToe(sleutel: string): boolean {
      const nu = Date.now();
      let emmer = emmers.get(sleutel);
      if (!emmer) {
        if (emmers.size >= maxEmmers) evictOudste();
        emmer = { tokens: capaciteit, laatst: nu };
        emmers.set(sleutel, emmer);
      } else {
        vulAan(emmer, nu);
      }
      if (emmer.tokens >= 1) {
        emmer.tokens -= 1;
        return true;
      }
      return false;
    },
    omvang: () => emmers.size,
    stop: () => clearInterval(opruim),
  };
}
