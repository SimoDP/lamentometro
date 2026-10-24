"use client";

import { useApi } from "@/components/client";
import { ErrorBox, NoGame, useCurrentGameId } from "@/components/Shell";

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

type Stats = { partner: string; daysPlayed: number; skipped: number; ties: number; me: PlayerStats; partnerStats: PlayerStats };

export default function Statistiche() {
  const { gameId, loading } = useCurrentGameId();
  if (loading) return <p className="muted">Caricamento…</p>;
  if (!gameId) return <NoGame />;
  return <StatsView gameId={gameId} />;
}

const ROWS: [keyof PlayerStats, string][] = [
  ["won", "Giornate vinte"],
  ["lost", "Penitenze fatte"],
  ["currentStreak", "Serie di vittorie attuale"],
  ["bestStreak", "Serie di vittorie migliore"],
  ["pointsTaken", "Punti tolti all'altro"],
  ["pointsLost", "Punti persi"],
  ["lamenti", "Lamenti segnati"],
  ["superLamenti", "SuperLamenti segnati"],
  ["contestsMade", "Contestazioni fatte"],
  ["contestsWon", "Contestazioni vinte"],
];

function StatsView({ gameId }: { gameId: number }) {
  const { data: s, error } = useApi<Stats>(`games/${gameId}/stats`);
  if (error) return <ErrorBox error={error} />;
  if (!s) return <p className="muted">Caricamento…</p>;

  return (
    <>
      <h1>Statistiche</h1>
      <p className="sub">Contano solo le giornate concluse.</p>
      <div className="card">
        <div className="tiles">
          <div className="tile">
            <div className="v">{s.daysPlayed}</div>
            <div className="l">Giornate giocate</div>
          </div>
          <div className="tile">
            <div className="v">{s.ties}</div>
            <div className="l">Pareggi</div>
          </div>
          <div className="tile">
            <div className="v">{s.skipped}</div>
            <div className="l">Giornate saltate</div>
          </div>
          <div className="tile">
            <div className="v">
              {s.me.won}–{s.partnerStats.won}
            </div>
            <div className="l">Vittorie tu – {s.partner}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="vs">
          <span />
          <span className="h">Tu</span>
          <span className="h">{s.partner}</span>
          {ROWS.map(([k, label]) => (
            <Row key={k} label={label} a={s.me[k] as number} b={s.partnerStats[k] as number} />
          ))}
        </div>
      </div>
      <div className="card">
        <h2>La lamentela più frequente</h2>
        <p style={{ margin: "0 0 6px" }}>
          Tua: <b>{s.me.topComplaint ? `${s.me.topComplaint.title} (${times(s.me.topComplaint.count)})` : "nessuna con titolo"}</b>
        </p>
        <p style={{ margin: 0 }}>
          Di {s.partner}:{" "}
          <b>{s.partnerStats.topComplaint ? `${s.partnerStats.topComplaint.title} (${times(s.partnerStats.topComplaint.count)})` : "nessuna con titolo"}</b>
        </p>
      </div>
    </>
  );
}

const times = (n: number) => (n === 1 ? "1 volta" : `${n} volte`);

function Row({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <>
      <span>{label}</span>
      <span className="n">{a}</span>
      <span className="n">{b}</span>
    </>
  );
}
