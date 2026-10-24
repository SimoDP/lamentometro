import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "./db";
import { fail, str } from "./errors";
import { isoNow, now } from "./time";
import { sendMail } from "./mail";

export type User = { id: number; email: string; username: string; created_at: string };

const SESSION_DAYS = 60;
const PIN_MINUTES = 15;
const PIN_MAX_ATTEMPTS = 5;

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function publicUser(u: User) {
  return { id: u.id, username: u.username };
}

export function getUserById(id: number): User | undefined {
  return db().prepare("SELECT id, email, username, created_at FROM users WHERE id = ?").get(id) as User | undefined;
}

export function register(input: { email?: unknown; username?: unknown; password?: unknown }): User {
  const email = str(input.email, 200)?.toLowerCase();
  const username = str(input.username, 50);
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !EMAIL_RE.test(email)) fail("Email non valida");
  if (!username || !USERNAME_RE.test(username))
    fail("Il nome utente deve avere da 3 a 20 caratteri tra lettere, numeri, punto e trattino basso");
  if (password.length < 8) fail("La password deve avere almeno 8 caratteri");
  const d = db();
  if (d.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fail("Esiste già un account con questa email");
  if (d.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) fail("Questo nome utente è già preso");
  const hash = bcrypt.hashSync(password, 10);
  const r = d
    .prepare("INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(email, username, hash, isoNow());
  return getUserById(Number(r.lastInsertRowid))!;
}

export function login(input: { email?: unknown; password?: unknown }): User {
  const email = str(input.email, 200)?.toLowerCase() ?? "";
  const password = typeof input.password === "string" ? input.password : "";
  const row = db().prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
    | { id: number; password_hash: string }
    | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) fail("Email o password sbagliate", 401);
  return getUserById(row.id)!;
}

export function createSession(userId: number): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(now().getTime() + SESSION_DAYS * 86400_000);
  db().prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires.toISOString());
  return { token, expires };
}

export function userFromSession(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const row = db().prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token) as
    | { user_id: number; expires_at: string }
    | undefined;
  if (!row || row.expires_at < isoNow()) return undefined;
  return getUserById(row.user_id);
}

export function destroySession(token: string | undefined) {
  if (token) db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** Genera un PIN di recupero e lo invia per email. Non rivela se l'email esiste. */
export async function requestPasswordReset(input: { email?: unknown }) {
  const email = str(input.email, 200)?.toLowerCase() ?? "";
  const user = db().prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
  if (!user) return;
  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = new Date(now().getTime() + PIN_MINUTES * 60_000).toISOString();
  db().prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(isoNow(), user.id);
  db()
    .prepare("INSERT INTO password_resets (user_id, pin_hash, expires_at) VALUES (?, ?, ?)")
    .run(user.id, bcrypt.hashSync(pin, 8), expires);
  await sendMail(
    email,
    "Il tuo PIN per Lamentometro",
    `Il tuo PIN per reimpostare la password è ${pin}.\nScade tra ${PIN_MINUTES} minuti.\n\nSe non l'hai chiesto tu, ignora questa email.`,
  );
}

export function resetPassword(input: { email?: unknown; pin?: unknown; password?: unknown }): User {
  const email = str(input.email, 200)?.toLowerCase() ?? "";
  const pin = str(input.pin, 10) ?? "";
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 8) fail("La password deve avere almeno 8 caratteri");
  const d = db();
  const user = d.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;
  const reset = user
    ? (d
        .prepare(
          "SELECT id, pin_hash, expires_at, attempts FROM password_resets WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .get(user.id) as { id: number; pin_hash: string; expires_at: string; attempts: number } | undefined)
    : undefined;
  if (!user || !reset || reset.expires_at < isoNow() || reset.attempts >= PIN_MAX_ATTEMPTS)
    fail("PIN scaduto o non valido: richiedine uno nuovo");
  if (!bcrypt.compareSync(pin, reset.pin_hash)) {
    d.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?").run(reset.id);
    fail("PIN sbagliato");
  }
  d.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(isoNow(), reset.id);
  d.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), user.id);
  d.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  return getUserById(user.id)!;
}
