"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect } from "react";
import { useApi } from "./client";

export type Me = {
  user: { id: number; username: string; email: string } | null;
  activeGameId: number | null;
  inboxCount: number;
};

const MeContext = createContext<{ me: Me; reloadMe: () => void } | null>(null);

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe fuori dalla Shell");
  return ctx;
}

const LINKS = [
  { href: "/", ico: "😤", label: "Gioco" },
  { href: "/storico", ico: "📜", label: "Storico" },
  { href: "/statistiche", ico: "📊", label: "Statistiche" },
  { href: "/inviti", ico: "📬", label: "Inviti" },
  { href: "/profilo", ico: "👤", label: "Profilo" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { data: me, reload } = useApi<Me>("me", 15000);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (me && !me.user) router.replace("/accedi");
  }, [me, router]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (!me?.user) return <main className="muted">Caricamento…</main>;

  return (
    <MeContext.Provider value={{ me, reloadMe: reload }}>
      <main>{children}</main>
      <nav className="nav">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "on" : ""}>
            <span className="ico">{l.ico}</span>
            {l.label}
            {l.href === "/inviti" && me.inboxCount > 0 && <span className="dot">{me.inboxCount}</span>}
          </Link>
        ))}
      </nav>
    </MeContext.Provider>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="error">{error}</div> : null;
}

/** Il gioco da mostrare: quello attivo, oppure uno terminato che non ho ancora eliminato. */
export function useCurrentGameId(): { gameId: number | null; loading: boolean } {
  const { me } = useMe();
  const { data: games } = useApi<{ id: number; ended: boolean }[]>(me.activeGameId ? null : "games");
  if (me.activeGameId) return { gameId: me.activeGameId, loading: false };
  if (!games) return { gameId: null, loading: true };
  return { gameId: games[0]?.id ?? null, loading: false };
}

export function NoGame() {
  return (
    <div className="card empty">
      <div className="big-emoji">🫶</div>
      <h2>Nessun gioco attivo</h2>
      <p className="muted">
        Cerca l&apos;altra persona dal tuo profilo, seguila e invitala a giocare. Gli inviti ricevuti li trovi in Inviti.
      </p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link className="btn" href="/profilo">
          Trova la tua coppia
        </Link>
        <Link className="btn ghost" href="/inviti">
          Inviti
        </Link>
      </div>
    </div>
  );
}
