"use client";

import { useEffect, useState } from "react";
import { api, formatTime, useAction } from "./client";
import { ErrorBox, Sheet } from "./Shell";

export type ComplaintView = {
  id: number;
  day: string;
  points: number;
  title: string | null;
  description: string | null;
  createdAt: string;
  byMe: boolean;
  author: string;
  target: string;
  cancelled: "undo" | "contest" | null;
  canUndo: boolean;
  undoUntil: string;
  canContest: boolean;
  contest: null | {
    id: number;
    kind: "edit" | "cancel";
    status: "pending" | "accepted" | "rejected" | "void";
    newTitle: string | null;
    newDescription: string | null;
    reason: string | null;
    before: { title: string | null; description: string | null } | null;
    after: { title: string | null; description: string | null; cancelled: boolean } | null;
    canResolve: boolean;
  };
};

const CONTEST_STATUS = {
  pending: ["In attesa di risposta", "warn"],
  accepted: ["Contestazione accettata", "ok"],
  rejected: ["Contestazione rifiutata", "bad"],
  void: ["Contestazione decaduta", ""],
} as const;

function useCountdown(until: string, active: boolean) {
  const [left, setLeft] = useState(() => new Date(until).getTime() - Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until, active]);
  return Math.max(0, left);
}

function Item({ c, onChange }: { c: ComplaintView; onChange: () => void }) {
  const left = useCountdown(c.undoUntil, c.canUndo);
  const [contesting, setContesting] = useState(false);
  const { busy, error, run } = useAction();
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  return (
    <div className={`complaint ${c.cancelled ? "cancelled" : ""}`}>
      <div className="row between">
        <div className="grow">
          <div className="ctitle">{c.title || (c.points === 3 ? "SuperLamento" : "Lamento")}</div>
          <div className="small muted">
            {c.byMe ? `Hai segnato a ${c.target}` : `${c.author} ti ha segnato`} · {formatTime(c.createdAt)}
            {c.cancelled === "undo" && " · annullata"}
            {c.cancelled === "contest" && " · annullata dopo contestazione"}
          </div>
        </div>
        <span className={`pill ${c.points === 3 ? "super" : ""}`}>-{c.points}</span>
      </div>
      {c.description && <p style={{ margin: "6px 0 0" }}>{c.description}</p>}
      {c.contest && (
        <div className="diff">
          <span className={`badge ${CONTEST_STATUS[c.contest.status][1]}`}>{CONTEST_STATUS[c.contest.status][0]}</span>{" "}
          {c.contest.kind === "cancel" ? "Richiesta: annullare la lamentela" : "Richiesta: cambiare titolo e descrizione"}
          {c.contest.reason && <div className="muted">Motivo: {c.contest.reason}</div>}
          {c.contest.kind === "edit" && c.contest.status === "pending" && (
            <div className="muted">
              Proposta: «{c.contest.newTitle || "senza titolo"}»{c.contest.newDescription ? ` · ${c.contest.newDescription}` : ""}
            </div>
          )}
          {c.contest.before && c.contest.after && (
            <div className="muted">
              Prima: «{c.contest.before.title || "senza titolo"}»{c.contest.before.description ? ` · ${c.contest.before.description}` : ""}
              <br />
              Dopo:{" "}
              {c.contest.after.cancelled
                ? "annullata"
                : `«${c.contest.after.title || "senza titolo"}»${c.contest.after.description ? ` · ${c.contest.after.description}` : ""}`}
            </div>
          )}
          {c.contest.canResolve && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small ok" disabled={busy} onClick={() => run(() => api("POST", `contests/${c.contest!.id}/accept`)).then(onChange)}>
                Accetta
              </button>
              <button className="small ghost" disabled={busy} onClick={() => run(() => api("POST", `contests/${c.contest!.id}/reject`)).then(onChange)}>
                Rifiuta
              </button>
            </div>
          )}
        </div>
      )}
      <ErrorBox error={error} />
      {(c.canUndo && left > 0) || c.canContest ? (
        <div className="row" style={{ marginTop: 8 }}>
          {c.canUndo && left > 0 && (
            <button className="small ghost" disabled={busy} onClick={() => run(() => api("POST", `complaints/${c.id}/undo`)).then(onChange)}>
              Annulla ({mm}:{ss})
            </button>
          )}
          {c.canContest && (
            <button className="small ghost" onClick={() => setContesting(true)}>
              Contesta
            </button>
          )}
        </div>
      ) : null}
      {contesting && <ContestSheet c={c} onClose={() => setContesting(false)} onDone={onChange} />}
    </div>
  );
}

function ContestSheet({ c, onClose, onDone }: { c: ComplaintView; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"cancel" | "edit">("cancel");
  const [title, setTitle] = useState(c.title ?? "");
  const [description, setDescription] = useState(c.description ?? "");
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();

  const send = async () => {
    const done = await run(() => api("POST", `complaints/${c.id}/contest`, { kind, title, description, reason }));
    if (done) {
      onClose();
      onDone();
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2>Contesta la lamentela</h2>
      <p className="sub">Puoi contestarla una sola volta. Se {c.author} rifiuta, resta valida.</p>
      <ErrorBox error={error} />
      <div className={`choice ${kind === "cancel" ? "on" : ""}`} onClick={() => setKind("cancel")}>
        <input type="radio" checked={kind === "cancel"} readOnly /> Chiedi di annullarla (ti restituisce {c.points} punt{c.points === 1 ? "o" : "i"})
      </div>
      <div className={`choice ${kind === "edit" ? "on" : ""}`} onClick={() => setKind("edit")}>
        <input type="radio" checked={kind === "edit"} readOnly /> Chiedi di cambiare titolo e descrizione
      </div>
      {kind === "edit" && (
        <>
          <div className="field">
            <label>Nuovo titolo</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          </div>
          <div className="field">
            <label>Nuova descrizione</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </div>
        </>
      )}
      <div className="field">
        <label>Perché la contesti? (facoltativo)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </div>
      <div className="row">
        <button className="grow" disabled={busy} onClick={send}>
          Invia contestazione
        </button>
        <button className="ghost" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </Sheet>
  );
}

export function ComplaintList({ items, onChange, empty }: { items: ComplaintView[]; onChange: () => void; empty?: string }) {
  if (!items.length) return <p className="muted small">{empty ?? "Nessuna lamentela."}</p>;
  return (
    <div>
      {items.map((c) => (
        <Item key={c.id} c={c} onChange={onChange} />
      ))}
    </div>
  );
}
