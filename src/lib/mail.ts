import nodemailer from "nodemailer";
import { fail } from "./errors";

/** Sentinella per i test: l'ultima email "inviata". */
export const sentMails: { to: string; subject: string; text: string }[] = [];

export async function sendMail(to: string, subject: string, text: string) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST) {
    // Senza SMTP configurato (sviluppo e test) l'email finisce nel log.
    sentMails.push({ to, subject, text });
    console.log(`[mail] a ${to}: ${subject}\n${text}`);
    return;
  }
  const port = Number(SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  // Le virgolette attorno al valore (comuni nei pannelli delle variabili d'ambiente) romperebbero il mittente.
  const from = (MAIL_FROM || SMTP_USER || "").trim().replace(/^(["'])(.*)\1$/, "$2");
  try {
    const info = await transport.sendMail({ from, to, subject, text });
    // Conferma che il server SMTP ha accettato l'email: utile per confrontarla con i log del provider.
    console.log(`[mail] inviata a ${to} da ${from}: messageId=${info.messageId} risposta="${info.response}"`);
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
    console.error(
      `[mail] invio a ${to} fallito: code=${err.code ?? "?"} responseCode=${err.responseCode ?? "?"} ${err.response ?? err.message ?? e}`,
    );
    fail("Non sono riuscito a inviare l'email. Riprova tra qualche minuto.", 502);
  }
}
