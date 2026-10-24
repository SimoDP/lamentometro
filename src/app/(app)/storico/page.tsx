"use client";

import { formatDay, useApi } from "@/components/client";
import { ErrorBox, NoGame, useCurrentGameId, useMe } from "@/components/Shell";
import { ComplaintList, type ComplaintView } from "@/components/Complaints";

type Day = {
  day: string;
  phase: "setup" | "live" | "skipped" | "done";
  startScore: number;
  myScore: number;
  partnerScore: number;
  loser: "me" | "partner" | null;
  penanceForMe: string | null;
  penanceForPartner: string | null;
  complaints: ComplaintView[];
};

export default function Storico() {
  const { gameId, loading } = useCurrentGameId();
  if (loading) return <p className="muted">Caricamento…</p>;
  if (!gameId) return <NoGame />;
  return <History gameId={gameId} />;
}

function History({ gameId }: { gameId: number }) {
  const { data: days, error, reload } = useApi<Day[]>(`games/${gameId}/history`);
  const { data: game } = useApi<{ game: { partner: { username: string } } }>(`games/${gameId}`);
  const { reloadMe } = useMe();
  const partner = game?.game.partner.username ?? "l'altro";
  if (error) return <ErrorBox error={error} />;
  if (!days) return <p className="muted">Caricamento…</p>;

  return (
    <>
      <h1>Storico</h1>
      <p className="sub">Tutti i punti tolti, giorno per giorno.</p>
      {days.map((d) => (
        <div key={d.day} className="card">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0, textTransform: "capitalize" }}>{formatDay(d.day)}</h2>
            <Result d={d} />
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            Tu {d.myScore} · {partner} {d.partnerScore} · si partiva da {d.startScore}
          </p>
          {d.phase === "done" && d.loser && (
            <p className="small" style={{ marginTop: 0 }}>
              Penitenza: <b>{d.loser === "me" ? d.penanceForMe : d.penanceForPartner}</b> ({d.loser === "me" ? "tocca a te" : `tocca a ${partner}`})
            </p>
          )}
          <ComplaintList
            items={d.complaints}
            onChange={() => {
              reload();
              reloadMe();
            }}
            empty="Nessuna lamentela in questa giornata."
          />
        </div>
      ))}
    </>
  );
}

function Result({ d }: { d: Day }) {
  if (d.phase === "setup") return <span className="badge warn">Scelta penitenze</span>;
  if (d.phase === "live") return <span className="badge">In corso</span>;
  if (d.phase === "skipped") return <span className="badge">Saltata</span>;
  if (!d.loser) return <span className="badge">Pareggio</span>;
  return d.loser === "me" ? <span className="badge bad">Hai perso</span> : <span className="badge ok">Hai vinto</span>;
}
