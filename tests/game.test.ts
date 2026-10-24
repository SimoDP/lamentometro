import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "@/lib/api";
import { resetDb } from "@/lib/db";
import { resetLimits } from "@/lib/ratelimit";
import { setNow } from "@/lib/time";
import { sentMails } from "@/lib/mail";

// 2026-10-24 è ora legale (UTC+2): le 08:00 a Roma sono le 06:00 UTC.
const rome = (day: string, time: string) => setNow(new Date(`${day}T${time}:00+02:00`));

async function call(token: string | undefined, method: string, path: string, body: Record<string, unknown> = {}) {
  const [p, q] = path.split("?");
  return handle({ method, path: p.split("/"), query: new URLSearchParams(q), body, token });
}

async function ok(token: string | undefined, method: string, path: string, body: Record<string, unknown> = {}) {
  const r = await call(token, method, path, body);
  if (r.status !== 200) throw new Error(`${method} ${path}: ${JSON.stringify(r.body)}`);
  return r as typeof r & { body: any };
}

const lastPin = () => sentMails.at(-1)!.text.match(/\d{6}/)![0];

async function signup(username: string) {
  const r = await ok(undefined, "POST", "auth/register", { email: `${username}@test.it`, username, password: "password123" });
  const token = r.setSession!.token;
  await ok(token, "POST", "auth/verify", { pin: lastPin() });
  return token;
}

/** Due utenti che si seguono e hanno un gioco attivo. */
async function setupGame(defaultScore = 10) {
  const a = await signup("anna");
  const b = await signup("bruno");
  await ok(a, "POST", "follows", { username: "bruno" });
  const reqs = (await ok(b, "GET", "inbox")).body.followRequests;
  await ok(b, "POST", `follows/${reqs[0].id}/accept`);
  const bId = (await ok(b, "GET", "me")).body.user.id;
  await ok(a, "POST", "game-invites", { toUserId: bId, defaultScore, deadline: "11:00", penances: ["Lavare i piatti", "Massaggio"] });
  const inv = (await ok(b, "GET", "inbox")).body.gameInvites[0];
  const gameId = (await ok(b, "POST", `game-invites/${inv.id}/accept`)).body.gameId;
  return { a, b, gameId };
}

beforeEach(() => {
  resetDb();
  resetLimits();
  rome("2026-10-24", "08:00");
});

describe("account", () => {
  it("obbliga a confermare l'email prima di usare l'app", async () => {
    const r = await ok(undefined, "POST", "auth/register", { email: "zoe@test.it", username: "zoe", password: "password123" });
    const t = r.setSession!.token;
    expect((await ok(t, "GET", "me")).body.user.verified).toBe(false);
    expect((await call(t, "GET", "games")).status).toBe(403);
    const pin = lastPin();
    expect((await call(t, "POST", "auth/verify", { pin: pin === "000000" ? "111111" : "000000" })).status).toBe(400);
    // Chi non ha confermato non si trova nella ricerca.
    const other = await signup("zack");
    expect((await ok(other, "GET", "users/search?q=zo")).body).toHaveLength(0);
    await ok(t, "POST", "auth/verify", { pin });
    expect((await ok(t, "GET", "me")).body.user.verified).toBe(true);
    expect((await ok(other, "GET", "users/search?q=zo")).body).toHaveLength(1);
  });

  it("permette di correggere l'email prima della conferma", async () => {
    const r = await ok(undefined, "POST", "auth/register", { email: "sbagliata@test.it", username: "zoe", password: "password123" });
    const t = r.setSession!.token;
    expect((await call(t, "POST", "auth/resend")).status).toBe(400);
    await ok(t, "POST", "auth/change-email", { email: "giusta@test.it" });
    expect(sentMails.at(-1)!.to).toBe("giusta@test.it");
    await ok(t, "POST", "auth/verify", { pin: lastPin() });
    await ok(undefined, "POST", "auth/login", { email: "giusta@test.it", password: "password123" });
  });

  it("rifiuta nomi utente ed email duplicati", async () => {
    await signup("anna");
    const r = await call(undefined, "POST", "auth/register", { email: "x@test.it", username: "ANNA", password: "password123" });
    expect(r.status).toBe(400);
  });

  it("recupera la password con il PIN via email", async () => {
    await signup("anna");
    await ok(undefined, "POST", "auth/forgot", { email: "anna@test.it" });
    const pin = sentMails.at(-1)!.text.match(/\d{6}/)![0];
    const wrong = await call(undefined, "POST", "auth/reset", { email: "anna@test.it", pin: "000000" === pin ? "111111" : "000000", password: "nuovapass1" });
    expect(wrong.status).toBe(400);
    await ok(undefined, "POST", "auth/reset", { email: "anna@test.it", pin, password: "nuovapass1" });
    await ok(undefined, "POST", "auth/login", { email: "anna@test.it", password: "nuovapass1" });
  });
});

describe("inviti", () => {
  it("serve seguire la persona per invitarla, e un solo gioco attivo a testa", async () => {
    const { a } = await setupGame();
    const c = await signup("carla");
    const cId = (await ok(c, "GET", "me")).body.user.id;
    const r = await call(a, "POST", "game-invites", { toUserId: cId, defaultScore: 10, penances: ["x"] });
    expect(r.status).toBe(400);
    await ok(a, "POST", "follows", { username: "carla" });
    await ok(c, "POST", `follows/${(await ok(c, "GET", "inbox")).body.followRequests[0].id}/accept`);
    const r2 = await call(a, "POST", "game-invites", { toUserId: cId, defaultScore: 10, penances: ["x"] });
    expect(r2.body).toEqual({ error: "Hai già un gioco attivo: eliminalo prima di crearne uno nuovo" });
  });
});

describe("giornata", () => {
  it("toglie 1 o 3 punti all'altro e si ferma a zero", async () => {
    const { a, b, gameId } = await setupGame(5);
    await ok(a, "POST", `games/${gameId}/complaints`, { points: 3, title: "Freddo" });
    await ok(a, "POST", `games/${gameId}/complaints`, { points: 3 });
    const v = (await ok(b, "GET", `games/${gameId}`)).body;
    expect(v.today.myScore).toBe(0);
    expect(v.today.partnerScore).toBe(5);
    expect((await call(a, "POST", `games/${gameId}/complaints`, { points: 2 })).status).toBe(400);
  });

  it("annulla entro 5 minuti, poi non più", async () => {
    const { a, gameId } = await setupGame();
    const id1 = (await ok(a, "POST", `games/${gameId}/complaints`, { points: 1 })).body.id;
    const id2 = (await ok(a, "POST", `games/${gameId}/complaints`, { points: 1 })).body.id;
    rome("2026-10-24", "08:04");
    await ok(a, "POST", `complaints/${id1}/undo`);
    rome("2026-10-24", "08:06");
    expect((await call(a, "POST", `complaints/${id2}/undo`)).status).toBe(400);
  });

  it("chi è più vicino a zero fa la penitenza scelta dall'altro; pareggio nessuno", async () => {
    const { a, b, gameId } = await setupGame();
    const pen = (await ok(a, "GET", `games/${gameId}`)).body.penances;
    await ok(a, "POST", `games/${gameId}/choice`, { penanceId: pen[0].id });
    // La scelta non si cambia.
    expect((await call(a, "POST", `games/${gameId}/choice`, { penanceId: pen[1].id })).status).toBe(400);
    await ok(b, "POST", `games/${gameId}/choice`, { penanceId: pen[1].id });
    rome("2026-10-24", "15:00");
    await ok(a, "POST", `games/${gameId}/complaints`, { points: 1 });
    expect((await ok(a, "GET", `games/${gameId}`)).body.today.phase).toBe("live");
    rome("2026-10-25", "09:00");
    const h = (await ok(b, "GET", `games/${gameId}/history`)).body;
    const day = h.find((d: any) => d.day === "2026-10-24");
    expect(day.phase).toBe("done");
    expect(day.loser).toBe("me");
    expect(day.penanceForMe).toBe("Lavare i piatti");
    const s = (await ok(a, "GET", `games/${gameId}/stats`)).body;
    expect(s.me.won).toBe(1);
    expect(s.partnerStats.lost).toBe(1);
  });

  it("salta la giornata se manca una penitenza alle 11", async () => {
    const { a, gameId } = await setupGame();
    const pen = (await ok(a, "GET", `games/${gameId}`)).body.penances;
    await ok(a, "POST", `games/${gameId}/choice`, { penanceId: pen[0].id });
    rome("2026-10-24", "11:00");
    expect((await ok(a, "GET", `games/${gameId}`)).body.today.phase).toBe("skipped");
    rome("2026-10-24", "11:05");
    const pen2 = (await ok(a, "GET", `games/${gameId}`)).body.penances;
    expect(pen2.length).toBe(2);
    rome("2026-10-25", "09:00");
    const s = (await ok(a, "GET", `games/${gameId}/stats`)).body;
    expect(s.skipped).toBe(1);
  });

  it("il punteggio del giorno cambia solo se l'altro accetta, entro l'orario limite", async () => {
    const { a, b, gameId } = await setupGame(10);
    await ok(a, "POST", `games/${gameId}/proposals`, { kind: "day_score", value: 20 });
    const p = (await ok(b, "GET", "inbox")).body.proposals[0];
    await ok(b, "POST", `proposals/${p.id}/accept`);
    expect((await ok(a, "GET", `games/${gameId}`)).body.today.startScore).toBe(20);
    await ok(a, "POST", `games/${gameId}/proposals`, { kind: "day_score", value: 30 });
    rome("2026-10-24", "11:30");
    const p2 = (await ok(b, "GET", `games/${gameId}`)).body.proposals;
    expect(p2).toHaveLength(0);
  });
});

describe("contestazioni", () => {
  it("accettata salva prima e dopo; massimo una per lamentela", async () => {
    const { a, b, gameId } = await setupGame();
    const id = (await ok(a, "POST", `games/${gameId}/complaints`, { points: 3, title: "Pigro" })).body.id;
    await ok(b, "POST", `complaints/${id}/contest`, { kind: "cancel", reason: "Non è vero" });
    expect((await call(b, "POST", `complaints/${id}/contest`, { kind: "cancel" })).status).toBe(400);
    const ct = (await ok(a, "GET", "inbox")).body.contests[0];
    await ok(a, "POST", `contests/${ct.id}/accept`);
    const v = (await ok(b, "GET", `games/${gameId}`)).body;
    expect(v.today.myScore).toBe(10);
    expect(v.complaints[0].contest.before).toEqual({ title: "Pigro", description: null, cancelled: false });
    expect(v.complaints[0].contest.after.cancelled).toBe(true);
  });

  it("rifiutata, la lamentela resta valida", async () => {
    const { a, b, gameId } = await setupGame();
    const id = (await ok(a, "POST", `games/${gameId}/complaints`, { points: 1, title: "Pigro" })).body.id;
    await ok(b, "POST", `complaints/${id}/contest`, { kind: "edit", title: "Stanco" });
    const ct = (await ok(a, "GET", "inbox")).body.contests[0];
    await ok(a, "POST", `contests/${ct.id}/reject`);
    const v = (await ok(b, "GET", `games/${gameId}`)).body;
    expect(v.today.myScore).toBe(9);
    expect(v.complaints[0].title).toBe("Pigro");
  });
});

describe("eliminazione", () => {
  it("chi elimina libera il posto; quando eliminano entrambi il gioco sparisce", async () => {
    const { a, b, gameId } = await setupGame();
    await ok(a, "POST", `games/${gameId}/delete`);
    expect((await ok(a, "GET", "me")).body.activeGameId).toBeNull();
    expect((await call(a, "GET", `games/${gameId}`)).status).toBe(404);
    const v = (await ok(b, "GET", `games/${gameId}`)).body;
    expect(v.game.ended).toBe(true);
    const exp = await ok(b, "GET", `games/${gameId}/export`);
    expect(exp.download).toContain(".json");
    await ok(b, "POST", `games/${gameId}/delete`);
    expect((await ok(b, "GET", "games")).body).toHaveLength(0);
  });
});

describe("primo giorno", () => {
  it("se il gioco nasce dopo l'orario limite si può scegliere fino a fine giornata", async () => {
    rome("2026-10-24", "15:00");
    const { a, b, gameId } = await setupGame();
    const v = (await ok(a, "GET", `games/${gameId}`)).body;
    expect(v.today.phase).toBe("setup");
    expect(v.today.deadline).toBe("23:59");
    await ok(a, "POST", `games/${gameId}/choice`, { penanceId: v.penances[0].id });
    await ok(b, "POST", `games/${gameId}/choice`, { penanceId: v.penances[1].id });
    rome("2026-10-25", "08:00");
    const h = (await ok(a, "GET", `games/${gameId}/history`)).body;
    expect(h.find((d: any) => d.day === "2026-10-24").phase).toBe("done");
    expect((await ok(a, "GET", `games/${gameId}`)).body.today.deadline).toBe("11:00");
  });
});

describe("sicurezza", () => {
  it("blocca i tentativi ripetuti di password sbagliata", async () => {
    await signup("anna");
    for (let i = 0; i < 8; i++) {
      const r = await call(undefined, "POST", "auth/login", { email: "anna@test.it", password: "sbagliata" });
      expect(r.status).toBe(401);
    }
    const r = await call(undefined, "POST", "auth/login", { email: "anna@test.it", password: "password123" });
    expect(r.status).toBe(429);
  });
});
