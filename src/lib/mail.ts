import nodemailer from "nodemailer";

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
  });
  await transport.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, text });
}
