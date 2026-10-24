"use client";

import { useRouter } from "next/navigation";
import { api, formatDay, useAction, useApi } from "@/components/client";
import { ErrorBox, useMe } from "@/components/Shell";

type Inbox = {
  count: number;
  followRequests: { id: number; username: string }[];
  gameInvites: { id: number; username: string; defaultScore: number; deadline: string; penances: string[] }[];
  sentFollows: { id: number; username: string }[];
  sentInvites: { id: number; username: string; defaultScore: number; deadline: string; penances: string[] }[];
  proposals: { id: number; kind: "day_score" | "default_score" | "deadline"; value: string; proposer: string }[];
  contests: {
    id: number;
    kind: "edit" | "cancel";
    by: string;
    reason: string | null;
    complaint: { title: string | null; description: string | null; points: number; day: string };
    newTitle: string | null;
    newDescription: string | null;
  }[];
};

const PROPOSAL = {
  day_score: (v: string) => `il punteggio di oggi a ${v}`,
  default_score: (v: string) => `il punteggio di default a ${v}`,
  deadline: (v: string) => `l'orario limite alle ${v}`,
};

export default function Inviti() {
  const { data, error, reload } = useApi<Inbox>("inbox", 15000);
  const { reloadMe } = useMe();
  const router = useRouter();
  const act = useAction();

  const doIt = (method: string, path: string, after?: (r: any) => void) =>
    act.run(async () => {
      const r = await api(method, path);
      reload();
      reloadMe();
      after?.(r);
    });

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Caricamento…</p>;
  const nothing = data.count === 0 && !data.sentFollows.length && !data.sentInvites.length;

  return (
    <>
      <h1>Inviti</h1>
      <p className="sub">Richieste, inviti a giocare, proposte e contestazioni da approvare.</p>
      <ErrorBox error={act.error} />
      {nothing && (
        <div className="card empty">
          <div className="big-emoji">📭</div>
          <p className="muted">Niente da approvare.</p>
        </div>
      )}

      {data.contests.map((c) => (
        <div className="card" key={`c${c.id}`}>
          <span className="badge warn">Contestazione</span>
          <p>
            <b>{c.by}</b> contesta la tua lamentela «{c.complaint.title || (c.complaint.points === 3 ? "SuperLamento" : "Lamento")}» (-{c.complaint.points},{" "}
            {formatDay(c.complaint.day)}).
          </p>
          {c.kind === "cancel" ? (
            <p>Chiede di annullarla.</p>
          ) : (
            <p>
              Propone: «{c.newTitle || "senza titolo"}»{c.newDescription ? ` · ${c.newDescription}` : ""}
            </p>
          )}
          {c.reason && <p className="muted">Motivo: {c.reason}</p>}
          <p className="small muted">Se rifiuti, la lamentela resta com&apos;è.</p>
          <div className="row">
            <button className="ok" disabled={act.busy} onClick={() => doIt("POST", `contests/${c.id}/accept`)}>
              Accetta
            </button>
            <button className="ghost" disabled={act.busy} onClick={() => doIt("POST", `contests/${c.id}/reject`)}>
              Rifiuta
            </button>
          </div>
        </div>
      ))}

      {data.proposals.map((p) => (
        <div className="card" key={`p${p.id}`}>
          <span className="badge">Proposta</span>
          <p>
            <b>{p.proposer}</b> propone di cambiare {PROPOSAL[p.kind](p.value)}.
          </p>
          <div className="row">
            <button className="ok" disabled={act.busy} onClick={() => doIt("POST", `proposals/${p.id}/accept`)}>
              Accetta
            </button>
            <button className="ghost" disabled={act.busy} onClick={() => doIt("POST", `proposals/${p.id}/reject`)}>
              Rifiuta
            </button>
          </div>
        </div>
      ))}

      {data.gameInvites.map((i) => (
        <div className="card" key={`g${i.id}`}>
          <span className="badge ok">Invito a giocare</span>
          <p>
            <b>{i.username}</b> ti invita a un gioco: {i.defaultScore} punti al giorno, penitenze da scegliere entro le {i.deadline}.
          </p>
          <p className="small muted">Penitenze: {i.penances.join(" · ")}</p>
          <div className="row">
            <button className="ok" disabled={act.busy} onClick={() => doIt("POST", `game-invites/${i.id}/accept`, () => router.push("/"))}>
              Accetta e gioca
            </button>
            <button className="ghost" disabled={act.busy} onClick={() => doIt("POST", `game-invites/${i.id}/reject`)}>
              Rifiuta
            </button>
          </div>
        </div>
      ))}

      {data.followRequests.map((f) => (
        <div className="card row between" key={`f${f.id}`}>
          <span className="grow">
            <b>{f.username}</b> vuole seguirti
          </span>
          <button className="small ok" disabled={act.busy} onClick={() => doIt("POST", `follows/${f.id}/accept`)}>
            Accetta
          </button>
          <button className="small ghost" disabled={act.busy} onClick={() => doIt("POST", `follows/${f.id}/reject`)}>
            Rifiuta
          </button>
        </div>
      ))}

      {(data.sentFollows.length > 0 || data.sentInvites.length > 0) && (
        <div className="card">
          <h2>Inviati da te</h2>
          {data.sentInvites.map((i) => (
            <div className="row between" key={`si${i.id}`} style={{ padding: "6px 0" }}>
              <span className="grow">Invito a giocare a {i.username}</span>
              <button className="small ghost" disabled={act.busy} onClick={() => doIt("POST", `game-invites/${i.id}/cancel`)}>
                Ritira
              </button>
            </div>
          ))}
          {data.sentFollows.map((f) => (
            <div className="row between" key={`sf${f.id}`} style={{ padding: "6px 0" }}>
              <span className="grow">Richiesta di seguire {f.username}</span>
              <button className="small ghost" disabled={act.busy} onClick={() => doIt("DELETE", `follows/${f.id}`)}>
                Ritira
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
