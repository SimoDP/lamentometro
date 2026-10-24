import { db } from "./db";
import { fail, int, str } from "./errors";
import { isoNow, isValidTime, today } from "./time";
import { notify } from "./push";
import { activeGameFor, gameInbox } from "./game";
import type { User } from "./auth";

type Follow = { id: number; follower_id: number; followee_id: number; status: "pending" | "accepted" };

function username(id: number): string {
  return (db().prepare("SELECT username FROM users WHERE id = ?").get(id) as { username: string } | undefined)?.username ?? "?";
}

function follow(a: number, b: number): Follow | undefined {
  return db().prepare("SELECT * FROM follows WHERE follower_id = ? AND followee_id = ?").get(a, b) as Follow | undefined;
}

export function searchUsers(me: User, q: unknown) {
  const query = str(q, 50);
  if (!query || query.length < 2) return [];
  const rows = db()
    .prepare("SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\' AND id != ? ORDER BY username LIMIT 20")
    .all(query.replace(/[\\%_]/g, (c) => "\\" + c) + "%", me.id) as { id: number; username: string }[];
  return rows.map((u) => ({
    ...u,
    following: follow(me.id, u.id)?.status ?? null,
    followsMe: follow(u.id, me.id)?.status ?? null,
  }));
}

export function requestFollow(me: User, input: { username?: unknown }) {
  const name = str(input.username, 50);
  const target = db().prepare("SELECT id, username FROM users WHERE username = ?").get(name) as
    | { id: number; username: string }
    | undefined;
  if (!target) fail("Utente non trovato", 404);
  if (target.id === me.id) fail("Non puoi seguire te stesso");
  const existing = follow(me.id, target.id);
  if (existing) fail(existing.status === "pending" ? "Richiesta già inviata" : "Lo segui già");
  db()
    .prepare("INSERT INTO follows (follower_id, followee_id, status, created_at) VALUES (?, ?, 'pending', ?)")
    .run(me.id, target.id, isoNow());
  notify(target.id, "Nuova richiesta", `${me.username} vuole seguirti`, "/inviti");
}

export function respondFollow(me: User, id: number, accept: boolean) {
  const f = db().prepare("SELECT * FROM follows WHERE id = ? AND followee_id = ? AND status = 'pending'").get(id, me.id) as
    | Follow
    | undefined;
  if (!f) fail("Richiesta non trovata", 404);
  if (accept) {
    db().prepare("UPDATE follows SET status = 'accepted' WHERE id = ?").run(id);
    notify(f.follower_id, "Richiesta accettata", `${me.username} ha accettato la tua richiesta`, "/profilo");
  } else {
    db().prepare("DELETE FROM follows WHERE id = ?").run(id);
  }
}

/** Smetti di seguire, annulla una richiesta o togli un follower. */
export function removeFollow(me: User, id: number) {
  const r = db().prepare("DELETE FROM follows WHERE id = ? AND (follower_id = ? OR followee_id = ?)").run(id, me.id, me.id);
  if (!r.changes) fail("Non trovato", 404);
}

export function listFollows(me: User) {
  const d = db();
  const following = d
    .prepare(
      "SELECT f.id, f.status, u.id AS userId, u.username FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY u.username",
    )
    .all(me.id);
  const followers = d
    .prepare(
      "SELECT f.id, f.status, u.id AS userId, u.username FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? AND f.status = 'accepted' ORDER BY u.username",
    )
    .all(me.id);
  return { following, followers };
}

export function createGameInvite(
  me: User,
  input: { toUserId?: unknown; defaultScore?: unknown; deadline?: unknown; penances?: unknown },
) {
  const toId = int(input.toUserId);
  const score = int(input.defaultScore);
  const deadline = input.deadline ?? "11:00";
  const penances = Array.isArray(input.penances)
    ? [...new Set(input.penances.map((p) => str(p, 200)).filter((p): p is string => !!p))]
    : [];
  if (!toId || !username(toId) || toId === me.id) fail("Utente non valido");
  if (follow(me.id, toId)?.status !== "accepted") fail("Puoi invitare solo le persone che segui");
  if (!score || score < 1 || score > 999) fail("Il punteggio giornaliero deve essere tra 1 e 999");
  if (!isValidTime(deadline)) fail("Orario limite non valido");
  if (penances.length < 1) fail("Aggiungi almeno una penitenza");
  if (activeGameFor(me.id)) fail("Hai già un gioco attivo: eliminalo prima di crearne uno nuovo");
  if (activeGameFor(toId)) fail(`${username(toId)} ha già un gioco attivo`);
  const dup = db()
    .prepare(
      "SELECT 1 FROM game_invites WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))",
    )
    .get(me.id, toId, toId, me.id);
  if (dup) fail("C'è già un invito in sospeso tra voi due");
  db()
    .prepare(
      "INSERT INTO game_invites (from_id, to_id, default_score, deadline, penances, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(me.id, toId, score, deadline, JSON.stringify(penances), isoNow());
  notify(toId, "Invito a giocare", `${me.username} ti ha invitato a un gioco di coppia`, "/inviti");
}

type Invite = {
  id: number;
  from_id: number;
  to_id: number;
  default_score: number;
  deadline: string;
  penances: string;
  status: string;
};

export function respondGameInvite(me: User, id: number, accept: boolean): number | null {
  const d = db();
  const inv = d.prepare("SELECT * FROM game_invites WHERE id = ? AND to_id = ? AND status = 'pending'").get(id, me.id) as
    | Invite
    | undefined;
  if (!inv) fail("Invito non trovato", 404);
  if (!accept) {
    d.prepare("UPDATE game_invites SET status = 'rejected' WHERE id = ?").run(id);
    notify(inv.from_id, "Invito rifiutato", `${me.username} ha rifiutato il gioco`, "/inviti");
    return null;
  }
  if (activeGameFor(me.id)) fail("Hai già un gioco attivo: eliminalo prima di accettare");
  if (activeGameFor(inv.from_id)) fail(`${username(inv.from_id)} ha già un gioco attivo`);
  const gameId = d.transaction(() => {
    const at = isoNow();
    const r = d
      .prepare(
        "INSERT INTO games (player1_id, player2_id, default_score, deadline, start_day, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(inv.from_id, inv.to_id, inv.default_score, inv.deadline, today(), at);
    const gid = Number(r.lastInsertRowid);
    const ins = d.prepare("INSERT INTO penances (game_id, text, created_by, created_at) VALUES (?, ?, ?, ?)");
    for (const p of JSON.parse(inv.penances) as string[]) ins.run(gid, p, inv.from_id, at);
    d.prepare("UPDATE game_invites SET status = 'accepted' WHERE id = ?").run(id);
    // Gli altri inviti in sospeso di entrambi non hanno più senso.
    d.prepare(
      "UPDATE game_invites SET status = 'cancelled' WHERE status = 'pending' AND (from_id IN (?, ?) OR to_id IN (?, ?))",
    ).run(inv.from_id, inv.to_id, inv.from_id, inv.to_id);
    return gid;
  })();
  notify(inv.from_id, "Si gioca!", `${me.username} ha accettato: il gioco è iniziato`, "/");
  return gameId;
}

export function cancelGameInvite(me: User, id: number) {
  const r = db()
    .prepare("UPDATE game_invites SET status = 'cancelled' WHERE id = ? AND from_id = ? AND status = 'pending'")
    .run(id, me.id);
  if (!r.changes) fail("Invito non trovato", 404);
}

/** Tutto ciò che aspetta una risposta, mostrato nella sezione Inviti. */
export function inbox(me: User) {
  const d = db();
  const followRequests = d
    .prepare(
      "SELECT f.id, u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? AND f.status = 'pending' ORDER BY f.id DESC",
    )
    .all(me.id);
  const mapInvite = (i: Invite & { username: string }) => ({
    id: i.id,
    username: i.username,
    defaultScore: i.default_score,
    deadline: i.deadline,
    penances: JSON.parse(i.penances),
  });
  const gameInvites = (
    d
      .prepare(
        "SELECT i.*, u.username FROM game_invites i JOIN users u ON u.id = i.from_id WHERE i.to_id = ? AND i.status = 'pending' ORDER BY i.id DESC",
      )
      .all(me.id) as (Invite & { username: string })[]
  ).map(mapInvite);
  const sentFollows = d
    .prepare(
      "SELECT f.id, u.username FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND f.status = 'pending' ORDER BY f.id DESC",
    )
    .all(me.id);
  const sentInvites = (
    d
      .prepare(
        "SELECT i.*, u.username FROM game_invites i JOIN users u ON u.id = i.to_id WHERE i.from_id = ? AND i.status = 'pending' ORDER BY i.id DESC",
      )
      .all(me.id) as (Invite & { username: string })[]
  ).map(mapInvite);
  const game = gameInbox(me);
  const count = followRequests.length + gameInvites.length + game.proposals.length + game.contests.length;
  return { count, followRequests, gameInvites, sentFollows, sentInvites, ...game };
}
