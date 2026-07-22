import { NextResponse } from "next/server";

const CHAT_API_URL = process.env.CHAT_API_URL ?? "";

export async function GET() {
  try {
    const res = await fetch(`${CHAT_API_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const ok = res.ok;
    return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
