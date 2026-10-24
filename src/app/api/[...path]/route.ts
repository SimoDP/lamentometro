import { NextRequest, NextResponse } from "next/server";
import { handle, SESSION_COOKIE } from "@/lib/api";

export const dynamic = "force-dynamic";

async function serve(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
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
