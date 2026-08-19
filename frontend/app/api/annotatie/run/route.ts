// BFF-route voor het starten en opzoeken van een agent-run (graph-qa /v1/runs).
//
// Waarom naast de bestaande agent-route: die koppelt de beurt aan de verbinding van één tabblad —
// wegklikken of herladen doodde het antwoord. Een run is een object van de server; starten,
// meekijken (`[id]/events`) en stoppen (`[id]/cancel`) zijn losse handelingen.

import { graphQaAuthHeader, graphQaBaseUrl } from "@/lib/config";
import { logger } from "@/lib/logger";
import { geenSessie, sessionUserId } from "@/app/api/_lib/session";

export const dynamic = "force-dynamic";

// Starten is een korte call: de agent zet een achtergrondtaak weg en antwoordt meteen. Het lange
// wachten gebeurt op de events-route, niet hier.
const START_TIMEOUT_MS = 15_000;

export async function POST(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();

  // De identiteit komt uit de sessie en wordt hier ingevoegd — nooit uit de browser-body. graph-qa
  // schrijft namens deze gebruiker naar de api, dus dit is een vertrouwensgrens: wie hem zelf mag
  // meesturen, schrijft in andermans gesprek.
  const binnen = await req.text();
  let body = binnen;
  try {
    body = JSON.stringify({ ...(JSON.parse(binnen) as Record<string, unknown>), user_id: userid });
  } catch {
    // Geen geldige JSON: laat de agent er zelf een 422 van maken in plaats van hier te raden.
  }

  try {
    // Bewust ZONDER `req.signal`: de browser die deze POST afbreekt mag de run niet meenemen —
    // dat was precies de oude fout. Alleen een eigen timeout op het starten zelf.
    const upstream = await fetch(`${graphQaBaseUrl()}/v1/runs`, {
      method: "POST",
      headers: { ...graphQaAuthHeader(), "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    const text = await upstream.text();
    // 409 (er loopt al een run) gaat ongewijzigd door: de client hoort daarop aan te haken bij het
    // meegegeven run_id, niet te falen.
    return new Response(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    logger.warn("Run-proxy: agent onbereikbaar", { fout: (err as Error).message });
    return Response.json({ detail: `Agent onbereikbaar (${(err as Error).message})` }, { status: 502 });
  }
}

/** `?gesprek=<id>` → de run waar je op kunt aanhaken, of `null`. Dit is wat de werkplek bij
 *  binnenkomst vraagt om een lopende beurt weer in beeld te krijgen. */
export async function GET(req: Request) {
  const userid = await sessionUserId();
  if (!userid) return geenSessie();

  const gesprek = new URL(req.url).searchParams.get("gesprek") ?? "";
  if (!gesprek) return Response.json(null);
  try {
    const upstream = await fetch(
      `${graphQaBaseUrl()}/v1/conversations/${encodeURIComponent(gesprek)}/run`,
      { headers: { ...graphQaAuthHeader() }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    const text = await upstream.text();
    return new Response(text || null, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    // Zachtjes falen: geen actieve run kunnen vinden mag de werkplek niet blokkeren — je ziet dan
    // gewoon de gehydrateerde geschiedenis, zoals voorheen.
    logger.warn("Run-proxy: actieve run niet op te halen", { fout: (err as Error).message });
    return Response.json(null);
  }
}
