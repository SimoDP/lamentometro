import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL,
  UNIQUE (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS game_invites (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_score INTEGER NOT NULL,
  deadline TEXT NOT NULL,
  penances TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  default_score INTEGER NOT NULL,
  deadline TEXT NOT NULL,
  start_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  ended_by INTEGER,
  deleted_by_p1 INTEGER NOT NULL DEFAULT 0,
  deleted_by_p2 INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS penances (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS game_days (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  start_score INTEGER NOT NULL,
  deadline TEXT NOT NULL,
  PRIMARY KEY (game_id, day)
);

CREATE TABLE IF NOT EXISTS penance_choices (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  chooser_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  penance_id INTEGER,
  penance_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (game_id, day, chooser_id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('day_score', 'default_score', 'deadline')),
  day TEXT,
  proposer_id INTEGER NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  points INTEGER NOT NULL CHECK (points IN (1, 3)),
  title TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT CHECK (cancel_reason IN ('undo', 'contest'))
);
CREATE INDEX IF NOT EXISTS complaints_game_day ON complaints (game_id, day);

CREATE TABLE IF NOT EXISTS contests (
  id INTEGER PRIMARY KEY,
  complaint_id INTEGER NOT NULL UNIQUE REFERENCES complaints(id) ON DELETE CASCADE,
  contester_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'cancel')),
  new_title TEXT,
  new_description TEXT,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'void')),
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __lamentometroDb: Database.Database | undefined;
}

function open(): Database.Database {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "lamentometro.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function db(): Database.Database {
  if (!globalThis.__lamentometroDb) globalThis.__lamentometroDb = open();
  return globalThis.__lamentometroDb;
}

/** Solo per i test: riparte da un database vuoto. */
export function resetDb() {
  globalThis.__lamentometroDb?.close();
  globalThis.__lamentometroDb = undefined;
}
