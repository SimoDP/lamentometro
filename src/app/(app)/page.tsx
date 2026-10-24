"use client";

import { useState } from "react";
import { api, formatDay, useAction, useApi } from "@/components/client";
import { ErrorBox, NoGame, Sheet, useCurrentGameId, useMe } from "@/components/Shell";
import { ComplaintList, type ComplaintView } from "@/components/Complaints";

type GameView = {
  game: { id: number; ended: boolean; endedBy: string | null; defaultScore: number; deadline: string; partner: { id: number; username: string } };
  today: {
    day: string;
    phase: "setup" | "live" | "skipped" | "done";
    deadline: string;
    startScore: number;
    myScore: number;
    partnerScore: number;
    myChoiceForPartner: string | null;
    partnerHasChosen: boolean;
    penanceForMe: string | null;
    loser: "me" | "partner" | null;
  };
  complaints: ComplaintView[];
  penances: { id: number; text: string }[];
  proposals: { id: number; kind: string; value: string; byMe: boolean; proposer: string }[];
};

export default function Gioco() {
  const { gameId, loading } = useCurrentGameId();
  if (loading) return <p className="muted">Caricamento…</p>;
  if (!gameId) return <NoGame />;
  return <GameScreen gameId={gameId} />;
}

function GameScreen({ gameId }: { gameId: number }) {
  const { data: v, error, reload } = useApi<GameView>(`games/${gameId}`, 10000);
  const { reloadMe } = useMe();
  const [complaining, setComplaining] = useState<1 | 3 | null>(null);
  const refresh = () => {
    reload();
    reloadMe();
  };

  if (error) return <ErrorBox error={error} />;
  if (!v) return <p className="muted">Caricamento…</p>;
  const { today: t, game: g } = v;
  const partner = g.partner.username;

  return (
    <>
      <h1>Oggi</h1>
      <p className="sub">
        {formatDay(t.day)} · con <b>{partner}</b>
      </p>

      {g.ended && <EndedCard g={g} />}

      <div className="scores">
        <Score who="Tu" value={t.myScore} max={t.startScore} />
        <Score who={partner} value={t.partnerScore} max={t.startScore} />
      </div>

      {!g.ended && <PhaseBanner t={t} partner={partner} />}

      {!g.ended && (
        <div className="actions">
          <button className="big" onClick={() => setComplaining(1)}>
            <span className="pts">-1</span>
            Lamento
          </button>
          <button className="big super" onClick={() => setComplaining(3)}>
            <span className="pts">-3</span>
            SuperLamento
          </button>
        </div>
      )}

      {!g.ended && t.phase === "setup" && <SetupCard v={v} onDone={refresh} />}

      {t.penanceForMe && (
        <div className="card">
          <h2>Le penitenze di oggi</h2>
          <p style={{ margin: "0 0 6px" }}>
            Se perdi tu: <b>{t.penanceForMe}</b>
          </p>
          <p style={{ margin: 0 }}>
            Se perde {partner}: <b>{t.myChoiceForPartner}</b>
          </p>
        </div>
      )}

      <div className="card">
        <h2>Lamentele di oggi</h2>
        <ComplaintList items={v.complaints} onChange={refresh} empty="Ancora nessuna lamentela oggi. Incredibile." />
      </div>

      {!g.ended && <PenancesCard gameId={g.id} penances={v.penances} onDone={refresh} />}

      {complaining && (
        <ComplainSheet gameId={g.id} points={complaining} partner={partner} onClose={() => setComplaining(null)} onDone={refresh} />
      )}
    </>
  );
}

function Score({ who, value, max }: { who: string; value: number; max: number }) {
  return (
    <div className="score">
      <div className="who">{who}</div>
      <div className="num">{value}</div>
      <div className="small muted">su {max}</div>
      <div className="bar">
        <span style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

function PhaseBanner({ t, partner }: { t: GameView["today"]; partner: string }) {
  let text: React.ReactNode;
  const bothChosen = !!t.myChoiceForPartner && t.partnerHasChosen;
  if (t.phase === "setup" && !bothChosen) text = <>Fino alle <b>{t.deadline}</b> scegliete le penitenze e il punteggio di oggi.</>;
  else if (t.phase === "skipped") text = <>Giornata saltata: alle {t.deadline} mancava almeno una penitenza. Ci si rifà domani.</>;
  else {
    const diff = t.myScore - t.partnerScore;
    text =
      diff === 0 ? (
        <>Siete pari: a mezzanotte nessuno fa la penitenza.</>
      ) : diff < 0 ? (
        <>Stai perdendo di {-diff}: se finisse ora la penitenza toccherebbe a te.</>
      ) : (
        <>Sei avanti di {diff}: se finisse ora la penitenza toccherebbe a {partner}.</>
      );
  }
  return (
    <div className="notice" style={{ marginBottom: 14 }}>
      {text}
    </div>
  );
}

function SetupCard({ v, onDone }: { v: GameView; onDone: () => void }) {
  const { today: t, game: g } = v;
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(String(t.startScore));
  const { busy, error, run } = useAction();
  const myScoreProposal = v.proposals.find((p) => p.kind === "day_score");

  return (
    <div className="card">
      <h2>Prima delle {t.deadline}</h2>
      <ErrorBox error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>
        La penitenza che scegli la farà {g.partner.username} se perde. Una volta scelta non si cambia.
      </p>
      {t.myChoiceForPartner ? (
        <p>
          ✅ Hai scelto per {g.partner.username}: <b>{t.myChoiceForPartner}</b>
        </p>
      ) : v.penances.length ? (
        <>
          {v.penances.map((p) => (
            <div key={p.id} className={`choice ${pick === p.id ? "on" : ""}`} onClick={() => setPick(p.id)}>
              <input type="radio" checked={pick === p.id} readOnly /> {p.text}
            </div>
          ))}
          <button className="full" disabled={!pick || busy} onClick={() => run(() => api("POST", `games/${g.id}/choice`, { penanceId: pick })).then(onDone)}>
            Conferma la penitenza
          </button>
        </>
      ) : (
        <p className="muted">Aggiungi almeno una penitenza alla lista qui sotto.</p>
      )}
      <p className="small">
        {t.partnerHasChosen ? `✅ ${g.partner.username} ha già scelto la tua.` : `⏳ ${g.partner.username} non ha ancora scelto la tua.`}
      </p>

      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
      <label htmlFor="dayscore">Punteggio di oggi (per entrambi)</label>
      {myScoreProposal ? (
        <p className="small">
          {myScoreProposal.byMe
            ? `Hai proposto ${myScoreProposal.value}: aspetta che ${g.partner.username} accetti.`
            : `${myScoreProposal.proposer} propone ${myScoreProposal.value}: rispondi in Inviti.`}
        </p>
      ) : (
        <div className="row">
          <input id="dayscore" className="grow" type="number" min={1} max={999} value={score} onChange={(e) => setScore(e.target.value)} />
          <button
            className="ghost"
            disabled={busy || Number(score) === t.startScore}
            onClick={() => run(() => api("POST", `games/${g.id}/proposals`, { kind: "day_score", value: Number(score) })).then(onDone)}
          >
            Proponi
          </button>
        </div>
      )}
    </div>
  );
}

function ComplainSheet(props: { gameId: number; points: 1 | 3; partner: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useAction();
  const send = async () => {
    const ok = await run(() => api("POST", `games/${props.gameId}/complaints`, { points: props.points, title, description }));
    if (ok) {
      props.onClose();
      props.onDone();
    }
  };
  return (
    <Sheet onClose={props.onClose}>
      <h2>{props.points === 3 ? "💥 SuperLamento" : "😤 Lamento"}</h2>
      <p className="sub">
        Togli {props.points} punt{props.points === 1 ? "o" : "i"} a {props.partner}. Titolo e descrizione sono facoltativi. Hai 5 minuti per annullare.
      </p>
      <ErrorBox error={error} />
      <div className="field">
        <label>Titolo</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Fa freddo" maxLength={100} />
      </div>
      <div className="field">
        <label>Descrizione</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      </div>
      <div className="row">
        <button className="grow" disabled={busy} onClick={send}>
          Segna -{props.points}
        </button>
        <button className="ghost" onClick={props.onClose}>
          Chiudi
        </button>
      </div>
    </Sheet>
  );
}

function PenancesCard({ gameId, penances, onDone }: { gameId: number; penances: { id: number; text: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  return (
    <div className="card">
      <div className="row between" onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <h2 style={{ margin: 0 }}>Lista penitenze ({penances.length})</h2>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          <ErrorBox error={error} />
          {penances.map((p) => (
            <div key={p.id} className="row between" style={{ padding: "6px 0" }}>
              <span className="grow">{p.text}</span>
              <button className="small ghost" disabled={busy} onClick={() => run(() => api("DELETE", `games/${gameId}/penances/${p.id}`)).then(onDone)}>
                Elimina
              </button>
            </div>
          ))}
          <form
            className="row"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api("POST", `games/${gameId}/penances`, { text })).then((ok) => ok && (setText(""), onDone()));
            }}
          >
            <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nuova penitenza" maxLength={200} />
            <button disabled={busy || !text.trim()}>Aggiungi</button>
          </form>
          <p className="small muted">Le penitenze già scelte per oggi restano valide anche se le elimini dalla lista.</p>
        </div>
      )}
    </div>
  );
}

function EndedCard({ g }: { g: GameView["game"] }) {
  const [sure, setSure] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="card">
      <h2>Gioco terminato</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {g.endedBy ? `${g.endedBy} ha chiuso il gioco.` : "Il gioco è chiuso."} Puoi scaricare il log come backup e poi eliminarlo per crearne uno nuovo.
      </p>
      <ErrorBox error={error} />
      <div className="row wrap">
        <a className="btn ghost" href={`/api/games/${g.id}/export`}>
          Scarica il log
        </a>
        <button className="danger" disabled={busy} onClick={() => (sure ? run(() => api("POST", `games/${g.id}/delete`)).then((ok) => ok && location.reload()) : setSure(true))}>
          {sure ? "Conferma eliminazione" : "Elimina"}
        </button>
      </div>
    </div>
  );
}
