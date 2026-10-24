import webpush from "web-push";
import { db } from "./db";
import { isoNow } from "./time";

let configured: boolean | null = null;

function ready(): boolean {
  if (configured !== null) return configured;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (configured) webpush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  return configured;
}

export function vapidPublicKey(): string | null {
  return ready() ? process.env.VAPID_PUBLIC_KEY! : null;
}

export function saveSubscription(userId: number, sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }) {
  if (typeof sub?.endpoint !== "string" || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return;
  db()
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, isoNow());
}

/** Invia una notifica push a tutti i dispositivi di un utente, senza bloccare la richiesta. */
export function notify(userId: number, title: string, body: string, url = "/") {
  if (!ready()) return;
  const subs = db().prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId) as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  const payload = JSON.stringify({ title, body, url });
  for (const s of subs) {
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .catch((err: { statusCode?: number }) => {
        // Abbonamento scaduto o revocato: lo togliamo.
        if (err?.statusCode === 404 || err?.statusCode === 410)
          db().prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
      });
  }
}
