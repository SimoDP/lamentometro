import * as auth from "./auth";
import * as game from "./game";
import * as social from "./social";
import { saveSubscription, vapidPublicKey } from "./push";
import { AppError, fail } from "./errors";
import { limit } from "./ratelimit";
import type { User } from "./auth";

export const SESSION_COOKIE = "lm_session";

export type ApiRequest = {
  method: string;
  path: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  token?: string;
  ip?: string;
};

export type ApiResult = {
  status: number;
  body: unknown;
  setSession?: { token: string; expires: Date } | null;
  download?: string;
};

type Ctx = { req: ApiRequest; params: Record<string, string>; user: User | undefined; me: () => User };
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

const routes: [string, string, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) => routes.push([method, pattern, h]);

const num = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) fail("Non trovato", 404);
  return n;
};

const emailKey = (body: Record<string, unknown>) => String(body.email ?? "").trim().toLowerCase();

// ---------- account ----------
// I limiti di frequenza rendono inutili i tentativi a forza bruta su password e PIN.
route("POST", "auth/register", async ({ req }) => {
  limit(`register:${req.ip}`, 5, 60);
  const u = await auth.register(req.body);
  return { $session: auth.createSession(u.id), user: auth.publicUser(u) };
});
route("POST", "auth/login", ({ req }) => {
  limit(`login:${req.ip}:${emailKey(req.body)}`, 8, 15);
  limit(`login:${req.ip}`, 40, 15);
  limit(`login:${emailKey(req.body)}`, 20, 15);
  const u = auth.login(req.body);
  return { $session: auth.createSession(u.id), user: auth.publicUser(u) };
});
route("POST", "auth/logout", ({ req }) => {
  auth.destroySession(req.token);
  return { $session: null, ok: true };
});
route("POST", "auth/forgot", async ({ req }) => {
  limit(`forgot:${emailKey(req.body)}`, 3, 15);
  limit(`forgot:${req.ip}`, 10, 60);
  await auth.requestPasswordReset(req.body);
  return { ok: true };
});
route("POST", "auth/reset", ({ req }) => {
  limit(`reset:${req.ip}`, 20, 15);
  const u = auth.resetPassword(req.body);
  return { $session: auth.createSession(u.id), user: auth.publicUser(u) };
});
route("POST", "auth/verify", ({ req, user }) => {
  limit(`verify:${req.ip}`, 20, 15);
  return auth.verifyEmail(user ?? fail("Devi accedere", 401), req.body);
});
route("POST", "auth/resend", async ({ user }) => {
  await auth.sendVerification(user ?? fail("Devi accedere", 401));
});
route("POST", "auth/change-email", async ({ req, user }) => {
  limit(`change-email:${user?.id}`, 5, 60);
  await auth.changeUnverifiedEmail(user ?? fail("Devi accedere", 401), req.body);
});
route("GET", "me", ({ user }) => {
  if (!user) return { user: null };
  if (!user.email_verified_at)
    return { user: { ...auth.publicUser(user), email: user.email, verified: false }, activeGameId: null, inboxCount: 0 };
  const active = game.activeGameFor(user.id);
  return {
    user: { ...auth.publicUser(user), email: user.email, verified: true },
    activeGameId: active?.id ?? null,
    inboxCount: social.inbox(user).count,
  };
});

// ---------- persone e inviti ----------
route("GET", "users/search", ({ req, me }) => social.searchUsers(me(), req.query.get("q")));
route("GET", "follows", ({ me }) => social.listFollows(me()));
route("POST", "follows", ({ req, me }) => social.requestFollow(me(), req.body));
route("POST", "follows/:id/accept", ({ params, me }) => social.respondFollow(me(), num(params.id), true));
route("POST", "follows/:id/reject", ({ params, me }) => social.respondFollow(me(), num(params.id), false));
route("DELETE", "follows/:id", ({ params, me }) => social.removeFollow(me(), num(params.id)));
route("GET", "inbox", ({ me }) => social.inbox(me()));
route("POST", "game-invites", ({ req, me }) => social.createGameInvite(me(), req.body));
route("POST", "game-invites/:id/accept", ({ params, me }) => ({ gameId: social.respondGameInvite(me(), num(params.id), true) }));
route("POST", "game-invites/:id/reject", ({ params, me }) => social.respondGameInvite(me(), num(params.id), false));
route("POST", "game-invites/:id/cancel", ({ params, me }) => social.cancelGameInvite(me(), num(params.id)));

// ---------- gioco ----------
route("GET", "games", ({ me }) => game.myGames(me()));
route("GET", "games/:id", ({ params, me }) => game.gameView(me(), num(params.id)));
route("GET", "games/:id/history", ({ params, me }) => game.history(me(), num(params.id)));
route("GET", "games/:id/stats", ({ params, me }) => game.stats(me(), num(params.id)));
route("GET", "games/:id/export", ({ params, me }) => ({ $download: `lamentometro-gioco-${params.id}.json`, data: game.exportGame(me(), num(params.id)) }));
route("POST", "games/:id/delete", ({ params, me }) => game.deleteGame(me(), num(params.id)));
route("POST", "games/:id/complaints", ({ params, req, me }) => ({ id: game.addComplaint(me(), num(params.id), req.body) }));
route("POST", "games/:id/penances", ({ params, req, me }) => game.addPenance(me(), num(params.id), req.body));
route("DELETE", "games/:id/penances/:pid", ({ params, me }) => game.deletePenance(me(), num(params.id), num(params.pid)));
route("POST", "games/:id/choice", ({ params, req, me }) => game.choosePenance(me(), num(params.id), req.body));
route("POST", "games/:id/proposals", ({ params, req, me }) => game.createProposal(me(), num(params.id), req.body));
route("POST", "proposals/:id/accept", ({ params, me }) => game.resolveProposal(me(), num(params.id), true));
route("POST", "proposals/:id/reject", ({ params, me }) => game.resolveProposal(me(), num(params.id), false));
route("POST", "complaints/:id/undo", ({ params, me }) => game.undoComplaint(me(), num(params.id)));
route("POST", "complaints/:id/contest", ({ params, req, me }) => game.contestComplaint(me(), num(params.id), req.body));
route("POST", "contests/:id/accept", ({ params, me }) => game.resolveContest(me(), num(params.id), true));
route("POST", "contests/:id/reject", ({ params, me }) => game.resolveContest(me(), num(params.id), false));

// ---------- notifiche ----------
route("GET", "push/key", () => ({ key: vapidPublicKey() }));
route("POST", "push/subscribe", ({ req, me }) => saveSubscription(me().id, req.body as never));

function match(pattern: string, path: string[]): Record<string, string> | null {
  const parts = pattern.split("/");
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = path[i];
    else if (parts[i] !== path[i]) return null;
  }
  return params;
}

export async function handle(req: ApiRequest): Promise<ApiResult> {
  try {
    for (const [method, pattern, h] of routes) {
      if (method !== req.method) continue;
      const params = match(pattern, req.path);
      if (!params) continue;
      const user = auth.userFromSession(req.token);
      // Tutto il resto dell'app richiede un'email confermata.
      const me = () => {
        if (!user) fail("Devi accedere", 401);
        if (!user.email_verified_at) fail("Conferma prima la tua email", 403);
        return user;
      };
      const out = (await h({ req, params, user, me })) as Record<string, unknown> | undefined;
      if (out && typeof out === "object" && !Array.isArray(out)) {
        if ("$download" in out) return { status: 200, body: out.data, download: out.$download as string };
        if ("$session" in out) {
          const { $session, ...rest } = out;
          return { status: 200, body: rest, setSession: $session as ApiResult["setSession"] };
        }
      }
      return { status: 200, body: out ?? { ok: true } };
    }
    return { status: 404, body: { error: "Non trovato" } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: "Errore del server" } };
  }
}
