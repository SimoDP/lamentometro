import { db } from "./db";
import { fail, int, str } from "./errors";
import { addDays, daysBetween, isoNow, isValidTime, now, romeParts } from "./time";
import { notify } from "./push";
import type { User } from "./auth";

export const LAMENTO = 1;
export const SUPER_LAMENTO = 3;
export const UNDO_MINUTES = 5;

export type Game = {
  id: number;
  player1_id: number;
  player2_id: number;
  default_score: number;
  deadline: string;
  start_day: string;
  created_at: string;
  ended_at: string | null;
  ended_by: number | null;
  deleted_by_p1: number;
  deleted_by_p2: number;
};

type DayRow = { game_id: number; day: string; start_score: number; deadline: string };

type Complaint = {
  id: number;
  game_id: number;
  day: string;
  author_id: number;
  target_id: number;
  points: number;
  title: string | null;
  description: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: "undo" | "contest" | null;
};

type Contest = {
  id: number;
  complaint_id: number;
  contester_id: number;
  kind: "edit" | "cancel";
  new_title: string | null;
  new_description: string | null;
  reason: string | null;
  status: "pending" | "accepted" | "rejected" | "void";
  before_json: string | null;
  after_json: string | null;
  created_at: string;
  resolved_at: string | null;
};

type Proposal = {
  id: number;
  game_id: number;
  kind: "day_score" | "default_score" | "deadline";
  day: string | null;
  proposer_id: number;
  value: string;
  status: string;
  created_at: string;
};

/**
 * Fasi di una giornata:
 * - setup: prima dell'orario limite, si scelgono penitenze e punteggio
 * - live: orario limite passato, entrambe le penitenze scelte
 * - skipped: orario limite passato senza entrambe le penitenze, la giornata non conta
 * - done: giornata finita e valida, c'è un risultato
 */
export type Phase = "setup" | "live" | "skipped" | "done";

// ---------- accesso ai dati ----------

export function other(game: Game, userId: number): number {
  return game.player1_id === userId ? game.player2_id : game.player1_id;
}

function deletedBy(game: Game, userId: number): boolean {
  return game.player1_id === userId ? !!game.deleted_by_p1 : !!game.deleted_by_p2;
}

export function activeGameFor(userId: number): Game | undefined {
  return db()
    .prepare("SELECT * FROM games WHERE (player1_id = ? OR player2_id = ?) AND ended_at IS NULL ORDER BY id DESC LIMIT 1")
    .get(userId, userId) as Game | undefined;
}

export function getGame(me: User, gameId: number): Game {
  const g = db().prepare("SELECT * FROM games WHERE id = ?").get(gameId) as Game | undefined;
  if (!g || (g.player1_id !== me.id && g.player2_id !== me.id) || deletedBy(g, me.id)) fail("Gioco non trovato", 404);
  return g;
}

function activeGame(me: User, gameId: number): Game {
  const g = getGame(me, gameId);
  if (g.ended_at) fail("Questo gioco è terminato");
  return g;
}

function username(id: number): string {
  return (db().prepare("SELECT username FROM users WHERE id = ?").get(id) as { username: string } | undefined)?.username ?? "?";
}

/** Ultimo giorno del gioco: oggi, oppure il giorno in cui è stato chiuso. */
export function lastDay(game: Game): string {
  return game.ended_at ? romeParts(new Date(game.ended_at)).day : romeParts().day;
}

function dayRow(game: Game, day: string): DayRow | undefined {
  return db().prepare("SELECT * FROM game_days WHERE game_id = ? AND day = ?").get(game.id, day) as DayRow | undefined;
}

/** La riga della giornata si crea alla prima visita, con i valori di default del momento. */
export function ensureDay(game: Game, day: string): DayRow {
  // Se il gioco nasce dopo l'orario limite, il primo giorno c'è tempo fino a fine giornata per scegliere.
  const created = romeParts(new Date(game.created_at));
  const deadline = day === game.start_day && created.time >= game.deadline ? "23:59" : game.deadline;
  db()
    .prepare("INSERT OR IGNORE INTO game_days (game_id, day, start_score, deadline) VALUES (?, ?, ?, ?)")
    .run(game.id, day, game.default_score, deadline);
  return dayRow(game, day)!;
}

function choices(game: Game, day: string) {
  return db().prepare("SELECT * FROM penance_choices WHERE game_id = ? AND day = ?").all(game.id, day) as {
    chooser_id: number;
    target_id: number;
    penance_text: string;
    created_at: string;
  }[];
}

function complaintsOf(game: Game, day?: string): Complaint[] {
  return (
    day
      ? db().prepare("SELECT * FROM complaints WHERE game_id = ? AND day = ? ORDER BY id DESC").all(game.id, day)
      : db().prepare("SELECT * FROM complaints WHERE game_id = ? ORDER BY id DESC").all(game.id)
  ) as Complaint[];
}

function contestsOf(game: Game): Map<number, Contest> {
  const rows = db()
    .prepare("SELECT c.* FROM contests c JOIN complaints k ON k.id = c.complaint_id WHERE k.game_id = ?")
    .all(game.id) as Contest[];
  return new Map(rows.map((c) => [c.complaint_id, c]));
}

// ---------- calcolo della giornata ----------

export function phaseOf(day: string, deadline: string, bothChosen: boolean): Phase {
  const { day: todayRome, time } = romeParts();
  if (day < todayRome) return bothChosen ? "done" : "skipped";
  if (time < deadline) return "setup";
  return bothChosen ? "live" : "skipped";
}

/** Punteggio di un giocatore: parte da start e non scende sotto zero. */
export function scoreFor(start: number, complaints: Complaint[], playerId: number): number {
  const lost = complaints
    .filter((c) => c.target_id === playerId && !c.cancelled_at)
    .reduce((sum, c) => sum + c.points, 0);
  return Math.max(0, start - lost);
}

/** Chi fa la penitenza: chi ha meno punti. Con il pareggio nessuno. */
export function loserOf(scores: Record<number, number>, a: number, b: number): number | null {
  if (scores[a] === scores[b]) return null;
  return scores[a] < scores[b] ? a : b;
}

type DaySummary = {
  day: string;
  phase: Phase;
  deadline: string;
  startScore: number;
  scores: Record<number, number>;
  loser: number | null;
  penanceFor: Record<number, string | null>;
  complaints: Complaint[];
};

function summarizeDay(game: Game, day: string, all?: Complaint[]): DaySummary {
  const row = dayRow(game, day);
  const start = row?.start_score ?? game.default_score;
  const deadline = row?.deadline ?? game.deadline;
  const ch = choices(game, day);
  const p1 = game.player1_id;
  const p2 = game.player2_id;
  const phase = phaseOf(day, deadline, ch.length === 2);
  const complaints = all ? all.filter((c) => c.day === day) : complaintsOf(game, day);
  const scores = { [p1]: scoreFor(start, complaints, p1), [p2]: scoreFor(start, complaints, p2) };
  const penanceFor = {
    [p1]: ch.find((c) => c.target_id === p1)?.penance_text ?? null,
    [p2]: ch.find((c) => c.target_id === p2)?.penance_text ?? null,
  };
  return {
    day,
    phase,
    deadline,
    startScore: start,
    scores,
    loser: phase === "done" ? loserOf(scores, p1, p2) : null,
    penanceFor,
    complaints,
  };
}

// ---------- viste per il client ----------

function complaintView(c: Complaint, contest: Contest | undefined, me: number) {
  const undoUntil = new Date(new Date(c.created_at).getTime() + UNDO_MINUTES * 60_000);
  return {
    id: c.id,
    day: c.day,
    points: c.points,
    title: c.title,
    description: c.description,
    createdAt: c.created_at,
    byMe: c.author_id === me,
    author: username(c.author_id),
    target: username(c.target_id),
    cancelled: c.cancelled_at ? c.cancel_reason : null,
    canUndo: c.author_id === me && !c.cancelled_at && now() < undoUntil,
    undoUntil: undoUntil.toISOString(),
    canContest: c.target_id === me && !c.cancelled_at && !contest,
    contest: contest
      ? {
          id: contest.id,
          kind: contest.kind,
          status: contest.status,
          newTitle: contest.new_title,
          newDescription: contest.new_description,
          reason: contest.reason,
          before: contest.before_json ? JSON.parse(contest.before_json) : null,
          after: contest.after_json ? JSON.parse(contest.after_json) : null,
          canResolve: contest.status === "pending" && c.author_id === me,
        }
      : null,
  };
}

function expireProposals(game: Game) {
  const { day, time } = romeParts();
  const row = dayRow(game, day);
  const deadline = row?.deadline ?? game.deadline;
  db()
    .prepare(
      "UPDATE proposals SET status = 'expired', resolved_at = ? WHERE game_id = ? AND status = 'pending' AND kind = 'day_score' AND (day != ? OR ? >= ?)",
    )
    .run(isoNow(), game.id, day, time, deadline);
}

function pendingProposals(game: Game): Proposal[] {
  expireProposals(game);
  return db().prepare("SELECT * FROM proposals WHERE game_id = ? AND status = 'pending' ORDER BY id").all(game.id) as Proposal[];
}

function proposalView(p: Proposal, me: number) {
  return { id: p.id, kind: p.kind, value: p.value, day: p.day, byMe: p.proposer_id === me, proposer: username(p.proposer_id) };
}

function penanceList(game: Game) {
  return db()
    .prepare("SELECT id, text FROM penances WHERE game_id = ? AND deleted_at IS NULL ORDER BY id")
    .all(game.id) as { id: number; text: string }[];
}

/** Stato completo della giornata di oggi, visto da me. */
export function gameView(me: User, gameId: number) {
  const game = getGame(me, gameId);
  const op = other(game, me.id);
  const day = lastDay(game);
  if (!game.ended_at) ensureDay(game, day);
  const s = summarizeDay(game, day);
  const contests = contestsOf(game);
  const ch = choices(game, day);
  const mine = ch.find((c) => c.chooser_id === me.id);
  const both = ch.length === 2;
  return {
    game: {
      id: game.id,
      ended: !!game.ended_at,
      endedBy: game.ended_by ? username(game.ended_by) : null,
      defaultScore: game.default_score,
      deadline: game.deadline,
      startDay: game.start_day,
      partner: { id: op, username: username(op) },
    },
    today: {
      day,
      phase: s.phase,
      deadline: s.deadline,
      startScore: s.startScore,
      myScore: s.scores[me.id],
      partnerScore: s.scores[op],
      // Scelgo io la penitenza per l'altro; quella per me la vedo quando l'hanno scelta entrambi.
      myChoiceForPartner: mine?.penance_text ?? null,
      partnerHasChosen: ch.some((c) => c.chooser_id === op),
      penanceForMe: both ? s.penanceFor[me.id] : null,
      loser: s.loser === null ? null : s.loser === me.id ? "me" : "partner",
    },
    complaints: s.complaints.map((c) => complaintView(c, contests.get(c.id), me.id)),
    penances: penanceList(game),
    proposals: game.ended_at ? [] : pendingProposals(game).map((p) => proposalView(p, me.id)),
  };
}

export function myGames(me: User) {
  const rows = db()
    .prepare(
      `SELECT * FROM games WHERE (player1_id = ? AND deleted_by_p1 = 0) OR (player2_id = ? AND deleted_by_p2 = 0)
       ORDER BY ended_at IS NOT NULL, id DESC`,
    )
    .all(me.id, me.id) as Game[];
  return rows.map((g) => ({
    id: g.id,
    partner: username(other(g, me.id)),
    startDay: g.start_day,
    ended: !!g.ended_at,
    endedAt: g.ended_at,
  }));
}

/** Proposte e contestazioni che aspettano una mia risposta. */
export function gameInbox(me: User) {
  const g = activeGameFor(me.id);
  if (!g) return { proposals: [], contests: [] };
  const proposals = pendingProposals(g)
    .filter((p) => p.proposer_id !== me.id)
    .map((p) => ({ ...proposalView(p, me.id), gameId: g.id }));
  const contests = (
    db()
      .prepare(
        `SELECT c.*, k.title, k.description, k.points, k.day FROM contests c JOIN complaints k ON k.id = c.complaint_id
         WHERE k.game_id = ? AND k.author_id = ? AND c.status = 'pending' ORDER BY c.id`,
      )
      .all(g.id, me.id) as (Contest & { title: string | null; description: string | null; points: number; day: string })[]
  ).map((c) => ({
    id: c.id,
    gameId: g.id,
    kind: c.kind,
    by: username(c.contester_id),
    reason: c.reason,
    complaint: { title: c.title, description: c.description, points: c.points, day: c.day },
    newTitle: c.new_title,
    newDescription: c.new_description,
  }));
  return { proposals, contests };
}

// ---------- azioni ----------

export function addComplaint(me: User, gameId: number, input: { points?: unknown; title?: unknown; description?: unknown }) {
  const game = activeGame(me, gameId);
  const points = int(input.points);
  if (points !== LAMENTO && points !== SUPER_LAMENTO) fail("Tipo di lamentela non valido");
  const day = romeParts().day;
  ensureDay(game, day);
  const target = other(game, me.id);
  const title = str(input.title, 100);
  const r = db()
    .prepare(
      "INSERT INTO complaints (game_id, day, author_id, target_id, points, title, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(game.id, day, me.id, target, points, title, str(input.description, 1000), isoNow());
  const what = points === SUPER_LAMENTO ? "un SuperLamento (-3)" : "un lamento (-1)";
  notify(target, "Ti sei lamentato!", `${me.username} ti ha segnato ${what}${title ? `: ${title}` : ""}`, "/");
  return Number(r.lastInsertRowid);
}

function complaintById(id: number): Complaint | undefined {
  return db().prepare("SELECT * FROM complaints WHERE id = ?").get(id) as Complaint | undefined;
}

export function undoComplaint(me: User, complaintId: number) {
  const c = complaintById(complaintId);
  if (!c || c.author_id !== me.id) fail("Lamentela non trovata", 404);
  activeGame(me, c.game_id);
  if (c.cancelled_at) fail("Lamentela già annullata");
  if (now().getTime() - new Date(c.created_at).getTime() > UNDO_MINUTES * 60_000)
    fail(`Si può annullare solo entro ${UNDO_MINUTES} minuti`);
  const at = isoNow();
  db().prepare("UPDATE complaints SET cancelled_at = ?, cancel_reason = 'undo' WHERE id = ?").run(at, c.id);
  db().prepare("UPDATE contests SET status = 'void', resolved_at = ? WHERE complaint_id = ? AND status = 'pending'").run(at, c.id);
}

export function contestComplaint(
  me: User,
  complaintId: number,
  input: { kind?: unknown; title?: unknown; description?: unknown; reason?: unknown },
) {
  const c = complaintById(complaintId);
  if (!c || c.target_id !== me.id) fail("Lamentela non trovata", 404);
  activeGame(me, c.game_id);
  if (c.cancelled_at) fail("Questa lamentela è già annullata");
  if (db().prepare("SELECT 1 FROM contests WHERE complaint_id = ?").get(c.id)) fail("Hai già contestato questa lamentela");
  const kind = input.kind === "cancel" ? "cancel" : input.kind === "edit" ? "edit" : null;
  if (!kind) fail("Tipo di contestazione non valido");
  const title = str(input.title, 100);
  const description = str(input.description, 1000);
  if (kind === "edit" && title === c.title && description === c.description) fail("Proponi un titolo o una descrizione diversi");
  db()
    .prepare(
      "INSERT INTO contests (complaint_id, contester_id, kind, new_title, new_description, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(c.id, me.id, kind, kind === "edit" ? title : null, kind === "edit" ? description : null, str(input.reason, 500), isoNow());
  notify(
    c.author_id,
    "Lamentela contestata",
    `${me.username} contesta ${kind === "cancel" ? "la lamentela" : "titolo e descrizione"}${c.title ? `: ${c.title}` : ""}`,
    "/inviti",
  );
}

export function resolveContest(me: User, contestId: number, accept: boolean) {
  const ct = db().prepare("SELECT * FROM contests WHERE id = ?").get(contestId) as Contest | undefined;
  const c = ct && complaintById(ct.complaint_id);
  if (!ct || !c || c.author_id !== me.id) fail("Contestazione non trovata", 404);
  activeGame(me, c.game_id);
  if (ct.status !== "pending") fail("Contestazione già risolta");
  const at = isoNow();
  const d = db();
  if (!accept) {
    d.prepare("UPDATE contests SET status = 'rejected', resolved_at = ? WHERE id = ?").run(at, ct.id);
  } else {
    const before = { title: c.title, description: c.description, cancelled: false };
    const after =
      ct.kind === "cancel"
        ? { ...before, cancelled: true }
        : { title: ct.new_title, description: ct.new_description, cancelled: false };
    d.transaction(() => {
      if (ct.kind === "cancel")
        d.prepare("UPDATE complaints SET cancelled_at = ?, cancel_reason = 'contest' WHERE id = ?").run(at, c.id);
      else d.prepare("UPDATE complaints SET title = ?, description = ? WHERE id = ?").run(after.title, after.description, c.id);
      d.prepare("UPDATE contests SET status = 'accepted', resolved_at = ?, before_json = ?, after_json = ? WHERE id = ?").run(
        at,
        JSON.stringify(before),
        JSON.stringify(after),
        ct.id,
      );
    })();
  }
  notify(ct.contester_id, accept ? "Contestazione accettata" : "Contestazione rifiutata", `${me.username} ha risposto alla tua contestazione`, "/storico");
}

export function addPenance(me: User, gameId: number, input: { text?: unknown }) {
  const game = activeGame(me, gameId);
  const text = str(input.text, 200);
  if (!text) fail("Scrivi la penitenza");
  db().prepare("INSERT INTO penances (game_id, text, created_by, created_at) VALUES (?, ?, ?, ?)").run(game.id, text, me.id, isoNow());
}

export function deletePenance(me: User, gameId: number, penanceId: number) {
  const game = activeGame(me, gameId);
  const r = db()
    .prepare("UPDATE penances SET deleted_at = ? WHERE id = ? AND game_id = ? AND deleted_at IS NULL")
    .run(isoNow(), penanceId, game.id);
  if (!r.changes) fail("Penitenza non trovata", 404);
}

export function choosePenance(me: User, gameId: number, input: { penanceId?: unknown }) {
  const game = activeGame(me, gameId);
  const day = romeParts().day;
  const row = ensureDay(game, day);
  if (romeParts().time >= row.deadline) fail(`La scelta della penitenza si chiude alle ${row.deadline}`);
  const p = db()
    .prepare("SELECT id, text FROM penances WHERE id = ? AND game_id = ? AND deleted_at IS NULL")
    .get(int(input.penanceId), game.id) as { id: number; text: string } | undefined;
  if (!p) fail("Penitenza non trovata", 404);
  const target = other(game, me.id);
  const r = db()
    .prepare(
      "INSERT OR IGNORE INTO penance_choices (game_id, day, chooser_id, target_id, penance_id, penance_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(game.id, day, me.id, target, p.id, p.text, isoNow());
  if (!r.changes) fail("Hai già scelto la penitenza di oggi: non si può cambiare");
  notify(target, "Penitenza scelta", `${me.username} ha scelto la tua penitenza di oggi`, "/");
}

export function createProposal(me: User, gameId: number, input: { kind?: unknown; value?: unknown }) {
  const game = activeGame(me, gameId);
  const kind = input.kind;
  let value: string;
  let day: string | null = null;
  if (kind === "day_score" || kind === "default_score") {
    const n = int(input.value);
    if (!n || n < 1 || n > 999) fail("Il punteggio deve essere tra 1 e 999");
    value = String(n);
    if (kind === "day_score") {
      day = romeParts().day;
      const row = ensureDay(game, day);
      if (romeParts().time >= row.deadline) fail(`Il punteggio di oggi si può cambiare solo prima delle ${row.deadline}`);
      if (row.start_score === n) fail("Il punteggio di oggi è già questo");
    } else if (game.default_score === n) fail("Il punteggio di default è già questo");
  } else if (kind === "deadline") {
    if (!isValidTime(input.value)) fail("Orario non valido");
    value = input.value;
    if (game.deadline === value) fail("L'orario limite è già questo");
  } else fail("Proposta non valida");
  const d = db();
  // Una nuova proposta dello stesso tipo sostituisce quella in sospeso.
  d.prepare("UPDATE proposals SET status = 'expired', resolved_at = ? WHERE game_id = ? AND kind = ? AND status = 'pending'").run(
    isoNow(),
    game.id,
    kind,
  );
  d.prepare(
    "INSERT INTO proposals (game_id, kind, day, proposer_id, value, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  ).run(game.id, kind, day, me.id, value, isoNow());
  const label =
    kind === "day_score" ? `punteggio di oggi a ${value}` : kind === "default_score" ? `punteggio di default a ${value}` : `orario limite alle ${value}`;
  notify(other(game, me.id), "Nuova proposta", `${me.username} propone di cambiare il ${label}`, "/inviti");
}

export function resolveProposal(me: User, proposalId: number, accept: boolean) {
  const p = db().prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId) as Proposal | undefined;
  if (!p) fail("Proposta non trovata", 404);
  const game = activeGame(me, p.game_id);
  expireProposals(game);
  const fresh = db().prepare("SELECT status FROM proposals WHERE id = ?").get(p.id) as { status: string };
  if (fresh.status === "expired") fail("Proposta scaduta");
  if (fresh.status !== "pending") fail("Proposta già risolta");
  if (p.proposer_id === me.id) fail("Deve rispondere l'altra persona");
  const d = db();
  const at = isoNow();
  d.transaction(() => {
    d.prepare("UPDATE proposals SET status = ?, resolved_at = ? WHERE id = ?").run(accept ? "accepted" : "rejected", at, p.id);
    if (!accept) return;
    const { day, time } = romeParts();
    const row = ensureDay(game, day);
    const inSetup = time < row.deadline;
    if (p.kind === "day_score") {
      d.prepare("UPDATE game_days SET start_score = ? WHERE game_id = ? AND day = ?").run(Number(p.value), game.id, day);
    } else if (p.kind === "default_score") {
      d.prepare("UPDATE games SET default_score = ? WHERE id = ?").run(Number(p.value), game.id);
      // Vale anche per oggi se siamo ancora nella fase di scelta e oggi non c'è un punteggio concordato.
      const custom = d
        .prepare("SELECT 1 FROM proposals WHERE game_id = ? AND kind = 'day_score' AND day = ? AND status = 'accepted'")
        .get(game.id, day);
      if (inSetup && !custom) d.prepare("UPDATE game_days SET start_score = ? WHERE game_id = ? AND day = ?").run(Number(p.value), game.id, day);
    } else {
      d.prepare("UPDATE games SET deadline = ? WHERE id = ?").run(p.value, game.id);
      if (inSetup && time < p.value) d.prepare("UPDATE game_days SET deadline = ? WHERE game_id = ? AND day = ?").run(p.value, game.id, day);
    }
  })();
  notify(p.proposer_id, accept ? "Proposta accettata" : "Proposta rifiutata", `${me.username} ha risposto alla tua proposta`, "/");
}

/** Elimina il gioco per me. Il gioco finisce; quando l'hanno eliminato entrambi sparisce dal server. */
export function deleteGame(me: User, gameId: number) {
  const game = getGame(me, gameId);
  const d = db();
  const col = game.player1_id === me.id ? "deleted_by_p1" : "deleted_by_p2";
  const otherCol = col === "deleted_by_p1" ? "deleted_by_p2" : "deleted_by_p1";
  if (game[otherCol]) {
    d.prepare("DELETE FROM games WHERE id = ?").run(game.id);
    return;
  }
  d.prepare(`UPDATE games SET ${col} = 1, ended_at = COALESCE(ended_at, ?), ended_by = COALESCE(ended_by, ?) WHERE id = ?`).run(
    isoNow(),
    me.id,
    game.id,
  );
  if (!game.ended_at) notify(other(game, me.id), "Gioco terminato", `${me.username} ha chiuso il gioco`, "/profilo");
}

// ---------- storico, statistiche, export ----------

export function history(me: User, gameId: number) {
  const game = getGame(me, gameId);
  const op = other(game, me.id);
  const all = complaintsOf(game);
  const contests = contestsOf(game);
  const days = daysBetween(game.start_day, lastDay(game)).reverse();
  return days.map((day) => {
    const s = summarizeDay(game, day, all);
    const visible = s.phase === "done" || s.phase === "live" || s.phase === "skipped";
    return {
      day,
      phase: s.phase,
      startScore: s.startScore,
      myScore: s.scores[me.id],
      partnerScore: s.scores[op],
      loser: s.loser === null ? null : s.loser === me.id ? "me" : "partner",
      penanceForMe: visible ? s.penanceFor[me.id] : null,
      penanceForPartner: s.penanceFor[op],
      complaints: s.complaints.map((c) => complaintView(c, contests.get(c.id), me.id)),
    };
  });
}

type PlayerStats = {
  won: number;
  lost: number;
  pointsTaken: number;
  pointsLost: number;
  lamenti: number;
  superLamenti: number;
  contestsMade: number;
  contestsWon: number;
  currentStreak: number;
  bestStreak: number;
  topComplaint: { title: string; count: number } | null;
};

export function computeStats(game: Game) {
  const p1 = game.player1_id;
  const p2 = game.player2_id;
  const all = complaintsOf(game);
  const contests = [...contestsOf(game).values()];
  const end = lastDay(game);
  const todayRome = romeParts().day;
  // Solo giornate concluse: prima di oggi, o l'ultimo giorno di un gioco chiuso.
  const lastClosed = game.ended_at ? end : addDays(todayRome, -1);
  const days = game.start_day <= lastClosed ? daysBetween(game.start_day, lastClosed) : [];
  const summaries = days.map((d) => summarizeDay(game, d, all));
  const played = summaries.filter((s) => s.phase === "done");
  const skipped = summaries.filter((s) => s.phase === "skipped").length;
  const ties = played.filter((s) => s.loser === null).length;

  const forPlayer = (id: number): PlayerStats => {
    const opp = id === p1 ? p2 : p1;
    let current = 0;
    let best = 0;
    let run = 0;
    for (const s of played) {
      if (s.loser === opp) run++;
      else run = 0;
      best = Math.max(best, run);
    }
    current = run;
    const valid = all.filter((c) => !c.cancelled_at);
    const titles = new Map<string, { title: string; count: number }>();
    for (const c of valid.filter((c) => c.target_id === id && c.title)) {
      const key = c.title!.toLowerCase();
      const t = titles.get(key) ?? { title: c.title!, count: 0 };
      t.count++;
      titles.set(key, t);
    }
    const top = [...titles.values()].sort((a, b) => b.count - a.count)[0] ?? null;
    const made = contests.filter((c) => c.contester_id === id);
    return {
      won: played.filter((s) => s.loser === opp).length,
      lost: played.filter((s) => s.loser === id).length,
      pointsTaken: valid.filter((c) => c.author_id === id).reduce((n, c) => n + c.points, 0),
      pointsLost: valid.filter((c) => c.target_id === id).reduce((n, c) => n + c.points, 0),
      lamenti: valid.filter((c) => c.author_id === id && c.points === LAMENTO).length,
      superLamenti: valid.filter((c) => c.author_id === id && c.points === SUPER_LAMENTO).length,
      contestsMade: made.length,
      contestsWon: made.filter((c) => c.status === "accepted").length,
      currentStreak: current,
      bestStreak: best,
      topComplaint: top,
    };
  };

  return { daysPlayed: played.length, skipped, ties, players: { [p1]: forPlayer(p1), [p2]: forPlayer(p2) } };
}

export function stats(me: User, gameId: number) {
  const game = getGame(me, gameId);
  const s = computeStats(game);
  const op = other(game, me.id);
  return {
    partner: username(op),
    daysPlayed: s.daysPlayed,
    skipped: s.skipped,
    ties: s.ties,
    me: s.players[me.id],
    partnerStats: s.players[op],
  };
}

export function exportGame(me: User, gameId: number) {
  const game = getGame(me, gameId);
  const d = db();
  const q = (sql: string) => d.prepare(sql).all(game.id);
  return {
    exportedAt: isoNow(),
    game: { ...game, player1: username(game.player1_id), player2: username(game.player2_id) },
    days: q("SELECT * FROM game_days WHERE game_id = ? ORDER BY day"),
    penances: q("SELECT * FROM penances WHERE game_id = ? ORDER BY id"),
    penanceChoices: q("SELECT * FROM penance_choices WHERE game_id = ? ORDER BY day"),
    proposals: q("SELECT * FROM proposals WHERE game_id = ? ORDER BY id"),
    complaints: q("SELECT * FROM complaints WHERE game_id = ? ORDER BY id"),
    contests: q("SELECT c.* FROM contests c JOIN complaints k ON k.id = c.complaint_id WHERE k.game_id = ? ORDER BY c.id"),
    stats: computeStats(game),
  };
}
