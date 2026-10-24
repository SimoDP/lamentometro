"use client";

import { useState } from "react";
import { api, formatDay, useAction, useApi } from "@/components/client";
import { ErrorBox, Sheet, useMe } from "@/components/Shell";

type Person = { id: number; status: "pending" | "accepted"; userId: number; username: string };
type Follows = { following: Person[]; followers: Person[] };
type SearchResult = { id: number; username: string; following: "pending" | "accepted" | null; followsMe: string | null };
type GameRow = { id: number; partner: string; startDay: string; ended: boolean };

export default function Profilo() {
  const { me } = useMe();
  return (
    <>
      <h1>{me.user!.username}</h1>
      <p className="sub">{me.user!.email}</p>
      <FriendsCard />
      {me.activeGameId && <GameSettings gameId={me.activeGameId} />}
      <GamesCard />
      <NotificationsCard />
      <button
        className="ghost full"
        onClick={async () => {
          await api("POST", "auth/logout");
          location.href = "/accedi";
        }}
      >
        Esci
      </button>
    </>
  );
}

function FriendsCard() {
  const { me } = useMe();
  const { data: follows, reload } = useApi<Follows>("follows");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [inviting, setInviting] = useState<Person | null>(null);
  const { busy, error, run } = useAction();

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => setResults(await api("GET", `users/search?q=${encodeURIComponent(q)}`)));
  };
  const followUser = (username: string) =>
    run(async () => {
      await api("POST", "follows", { username });
      setResults((r) => r?.map((x) => (x.username === username ? { ...x, following: "pending" } : x)) ?? null);
      reload();
    });

  return (
    <div className="card">
      <h2>Persone</h2>
      <ErrorBox error={error} />
      <form className="row" onSubmit={search}>
        <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un nome utente" autoCapitalize="none" />
        <button disabled={busy || q.trim().length < 2}>Cerca</button>
      </form>
      {results && (
        <div style={{ marginTop: 10 }}>
          {!results.length && <p className="muted small">Nessun utente trovato.</p>}
          {results.map((u) => (
            <div key={u.id} className="row between" style={{ padding: "6px 0" }}>
              <span className="grow">{u.username}</span>
              {u.following === "accepted" ? (
                <span className="badge ok">Lo segui</span>
              ) : u.following === "pending" ? (
                <span className="badge warn">Richiesta inviata</span>
              ) : (
                <button className="small" disabled={busy} onClick={() => followUser(u.username)}>
                  Segui
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 18 }}>Segui</h2>
      {!follows?.following.length && <p className="muted small">Non segui ancora nessuno.</p>}
      {follows?.following.map((f) => (
        <div key={f.id} className="row between" style={{ padding: "6px 0" }}>
          <span className="grow">
            {f.username} {f.status === "pending" && <span className="badge warn">in attesa</span>}
          </span>
          {f.status === "accepted" && !me.activeGameId && (
            <button className="small" onClick={() => setInviting(f)}>
              Invita a giocare
            </button>
          )}
          <button className="small ghost" disabled={busy} onClick={() => run(() => api("DELETE", `follows/${f.id}`)).then(reload)}>
            {f.status === "pending" ? "Ritira" : "Smetti"}
          </button>
        </div>
      ))}

      <h2 style={{ marginTop: 18 }}>Ti seguono</h2>
      {!follows?.followers.length && <p className="muted small">Ancora nessuno.</p>}
      {follows?.followers.map((f) => (
        <div key={f.id} className="row between" style={{ padding: "6px 0" }}>
          <span className="grow">{f.username}</span>
          <button className="small ghost" disabled={busy} onClick={() => run(() => api("DELETE", `follows/${f.id}`)).then(reload)}>
            Rimuovi
          </button>
        </div>
      ))}
      {inviting && <InviteSheet person={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}

const SUGGESTED = ["Lavare i piatti", "Massaggio di 10 minuti", "Colazione a letto", "Scegli tu il film stasera"];

function InviteSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const [score, setScore] = useState("10");
  const [deadline, setDeadline] = useState("11:00");
  const [penances, setPenances] = useState<string[]>(SUGGESTED);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  const add = () => {
    const t = text.trim();
    if (t && !penances.includes(t)) setPenances([...penances, t]);
    setText("");
  };

  if (sent)
    return (
      <Sheet onClose={onClose}>
        <h2>Invito inviato 🎉</h2>
        <p className="muted">Il gioco parte quando {person.username} accetta dalla sezione Inviti.</p>
        <button className="full" onClick={onClose}>
          Ok
        </button>
      </Sheet>
    );

  return (
    <Sheet onClose={onClose}>
      <h2>Nuovo gioco con {person.username}</h2>
      <p className="sub">Lamento -1 e SuperLamento -3 sono fissi. Il resto lo decidete voi.</p>
      <ErrorBox error={error} />
      <div className="row">
        <div className="field grow">
          <label>Punti al giorno (per entrambi)</label>
          <input type="number" min={1} max={999} value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <div className="field grow">
          <label>Scelta penitenze entro le</label>
          <input type="time" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <label>Penitenze</label>
      {penances.map((p) => (
        <div key={p} className="row between" style={{ padding: "4px 0" }}>
          <span className="grow">{p}</span>
          <button className="small ghost" onClick={() => setPenances(penances.filter((x) => x !== p))}>
            Togli
          </button>
        </div>
      ))}
      <div className="row" style={{ margin: "8px 0 14px" }}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Aggiungi una penitenza" onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="ghost" onClick={add} disabled={!text.trim()}>
          Aggiungi
        </button>
      </div>
      <div className="row">
        <button
          className="grow"
          disabled={busy}
          onClick={() =>
            run(() => api("POST", "game-invites", { toUserId: person.userId, defaultScore: Number(score), deadline, penances })).then(
              (ok) => ok && setSent(true),
            )
          }
        >
          Invia invito
        </button>
        <button className="ghost" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </Sheet>
  );
}

function GameSettings({ gameId }: { gameId: number }) {
  const { data: v, reload } = useApi<any>(`games/${gameId}`);
  const [score, setScore] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!v) return null;
  const pending = (kind: string) => v.proposals.find((p: any) => p.kind === kind);

  const propose = (kind: string, value: unknown) =>
    run(() => api("POST", `games/${gameId}/proposals`, { kind, value })).then((ok) => {
      if (ok) {
        setMsg(`Proposta inviata: ${v.game.partner.username} deve accettarla.`);
        reload();
      }
    });

  return (
    <div className="card">
      <h2>Gioco con {v.game.partner.username}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Iniziato {formatDay(v.game.startDay)}. Ogni modifica va accettata dall&apos;altra persona.
      </p>
      <ErrorBox error={error} />
      {msg && <p className="notice">{msg}</p>}
      <div className="field">
        <label>Punteggio di default ({v.game.defaultScore})</label>
        {pending("default_score") ? (
          <p className="small">In attesa: proposto {pending("default_score").value}</p>
        ) : (
          <div className="row">
            <input className="grow" type="number" min={1} max={999} value={score ?? v.game.defaultScore} onChange={(e) => setScore(e.target.value)} />
            <button className="ghost" disabled={busy || !score || Number(score) === v.game.defaultScore} onClick={() => propose("default_score", Number(score))}>
              Proponi
            </button>
          </div>
        )}
      </div>
      <div className="field">
        <label>Orario limite per le penitenze ({v.game.deadline})</label>
        {pending("deadline") ? (
          <p className="small">In attesa: proposto {pending("deadline").value}</p>
        ) : (
          <div className="row">
            <input className="grow" type="time" value={deadline ?? v.game.deadline} onChange={(e) => setDeadline(e.target.value)} />
            <button className="ghost" disabled={busy || !deadline || deadline === v.game.deadline} onClick={() => propose("deadline", deadline)}>
              Proponi
            </button>
          </div>
        )}
      </div>
      <div className="row wrap">
        <a className="btn ghost" href={`/api/games/${gameId}/export`}>
          Scarica il log
        </a>
        <button
          className="danger"
          disabled={busy}
          onClick={() => (sure ? run(() => api("POST", `games/${gameId}/delete`)).then((ok) => ok && location.reload()) : setSure(true))}
        >
          {sure ? "Sicuro? Il gioco finisce anche per l'altro" : "Elimina il gioco"}
        </button>
      </div>
    </div>
  );
}

function GamesCard() {
  const { data: games } = useApi<GameRow[]>("games");
  const { busy, error, run } = useAction();
  const [sure, setSure] = useState<number | null>(null);
  const ended = games?.filter((g) => g.ended) ?? [];
  if (!ended.length) return null;
  return (
    <div className="card">
      <h2>Giochi terminati</h2>
      <ErrorBox error={error} />
      {ended.map((g) => (
        <div key={g.id} className="row between wrap" style={{ padding: "6px 0" }}>
          <span className="grow">
            Con {g.partner} <span className="small muted">dal {formatDay(g.startDay)}</span>
          </span>
          <a className="btn ghost small" style={{ padding: "7px 12px", fontSize: "0.85rem" }} href={`/api/games/${g.id}/export`}>
            Log
          </a>
          <button
            className="small danger"
            disabled={busy}
            onClick={() => (sure === g.id ? run(() => api("POST", `games/${g.id}/delete`)).then((ok) => ok && location.reload()) : setSure(g.id))}
          >
            {sure === g.id ? "Conferma" : "Elimina"}
          </button>
        </div>
      ))}
    </div>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function NotificationsCard() {
  const { data } = useApi<{ key: string | null }>("push/key");
  const [state, setState] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data?.key) return null;

  const enable = () =>
    run(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error("Questo browser non supporta le notifiche. Su iPhone aggiungi prima l'app alla schermata Home.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permesso negato: abilita le notifiche dalle impostazioni del browser.");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.key!) }));
      await api("POST", "push/subscribe", sub.toJSON());
      setState("Notifiche attive su questo dispositivo.");
    });

  return (
    <div className="card">
      <h2>Notifiche</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Ti avvisiamo quando ti tolgono punti, ti contestano o ti invitano.
      </p>
      <ErrorBox error={error} />
      {state ? (
        <p className="notice">{state}</p>
      ) : (
        <button className="ghost" disabled={busy} onClick={enable}>
          Attiva le notifiche
        </button>
      )}
    </div>
  );
}
