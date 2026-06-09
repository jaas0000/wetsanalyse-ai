/**
 * In-memory rate limiting (token-bucket) voor het HTTP-transport.
 *
 * Reden (BIO2 / ISO 27002:2022, 8.6 capaciteitsbeheer + beschikbaarheid): zonder
 * begrenzing kan één client de SRU-bron en deze service overbelasten, en is
 * brute-force op de bearer-token ongelimiteerd. Een token-bucket staat bursts toe
 * tot `capaciteit` en vult daarna met `perSeconde` tokens aan.
 *
 * Sleutel = client-IP (uit X-Forwarded-For achter de proxy), zodat ook
 * niet-geauthenticeerde pogingen begrensd zijn. Alleen Node-stdlib.
 *
 * Configuratie (env):
 *   MCP_RATE_BURST   — emmergrootte / max. burst (default 60)
 *   MCP_RATE_PER_MIN — aanvulsnelheid per minuut (default 120)
 */
/** Lees de limiter-config uit de omgeving. */
export function leesRateConfig(env = process.env) {
    const capaciteit = Number(env.MCP_RATE_BURST ?? 60);
    const perMinuut = Number(env.MCP_RATE_PER_MIN ?? 120);
    return {
        capaciteit: capaciteit > 0 ? capaciteit : 60,
        perSeconde: perMinuut > 0 ? perMinuut / 60 : 2,
    };
}
export function maakRateLimiter(opts) {
    const { capaciteit, perSeconde } = opts;
    const idleMs = opts.idleMs ?? 10 * 60 * 1000;
    const emmers = new Map();
    function vulAan(emmer, nu) {
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
            if (nu - emmer.laatst > idleMs)
                emmers.delete(sleutel);
        }
    }, Math.min(idleMs, 5 * 60 * 1000));
    opruim.unref();
    return {
        staToe(sleutel) {
            const nu = Date.now();
            let emmer = emmers.get(sleutel);
            if (!emmer) {
                emmer = { tokens: capaciteit, laatst: nu };
                emmers.set(sleutel, emmer);
            }
            else {
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
