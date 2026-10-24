import { NextRequest, NextResponse } from "next/server";
import { handle, SESSION_COOKIE } from "@/lib/api";

export const dynamic = "force-dynamic";

async function serve(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Le richieste che modificano dati devono arrivare dal sito stesso (difesa da CSRF).
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let sameSite = false;
    try {
      sameSite = new URL(origin).host === host;
    } catch {}
    if (!sameSite) return NextResponse.json({ error: "Richiesta non consentita" }, { status: 403 });
  }
  let body: Record<string, unknown> = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = (await req.json()) ?? {};
    } catch {
      body = {};
    }
  }
  const result = await handle({
    method: req.method,
    path,
    query: req.nextUrl.searchParams,
    body,
    token: req.cookies.get(SESSION_COOKIE)?.value,
    // Dietro il proxy di Coolify l'IP reale del client è il primo di X-Forwarded-For.
    ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local",
  });
  const res = NextResponse.json(result.body, { status: result.status });
  if (result.download) res.headers.set("Content-Disposition", `attachment; filename="${result.download}"`);
  if (result.setSession === null) res.cookies.delete(SESSION_COOKIE);
  else if (result.setSession)
    res.cookies.set(SESSION_COOKIE, result.setSession.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: result.setSession.expires,
    });
  return res;
}

export { serve as GET, serve as POST, serve as DELETE };
