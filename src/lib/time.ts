// Tutte le regole del gioco seguono l'ora di Roma.
export const TZ = "Europe/Rome";

let fixedNow: Date | null = null;

/** Ora corrente; nei test si può fissare con setNow. */
export function now(): Date {
  return fixedNow ? new Date(fixedNow) : new Date();
}

export function setNow(d: Date | null) {
  fixedNow = d;
}

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Giorno (YYYY-MM-DD) e ora (HH:MM) a Roma per un istante. */
export function romeParts(d: Date = now()): { day: string; time: string } {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function today(): string {
  return romeParts().day;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Elenco dei giorni da `from` a `to` inclusi. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidTime(t: unknown): t is string {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

export function isoNow(): string {
  return now().toISOString();
}
