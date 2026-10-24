import { fail } from "./errors";
import { now } from "./time";

// Contatori in memoria: bastano per un solo server e si azzerano a ogni deploy.
const hits = new Map<string, number[]>();

/** Blocca chi supera `max` tentativi in `minutes` minuti per la stessa chiave. */
export function limit(key: string, max: number, minutes: number) {
  const t = now().getTime();
  const windowStart = t - minutes * 60_000;
  const list = (hits.get(key) ?? []).filter((x) => x > windowStart);
  if (list.length >= max) {
    hits.set(key, list);
    const wait = Math.max(1, Math.ceil((list[0] + minutes * 60_000 - t) / 60_000));
    fail(`Troppi tentativi: riprova tra ${wait} minut${wait === 1 ? "o" : "i"}`, 429);
  }
  list.push(t);
  hits.set(key, list);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (!v.some((x) => x > windowStart)) hits.delete(k);
  }
}

/** Solo per i test. */
export function resetLimits() {
  hits.clear();
}
