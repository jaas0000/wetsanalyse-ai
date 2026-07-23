import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const CHAT_API_URL = process.env.CHAT_API_URL ?? "";

export async function GET() {
  try {
    const res = await fetch(`${CHAT_API_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const ok = res.ok;
    return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
  } catch (err) {
    logger.warn("Health-proxy: agent onbereikbaar", { fout: (err as Error).message });
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
