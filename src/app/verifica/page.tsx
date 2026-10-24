"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, useAction, useApi } from "@/components/client";
import { ErrorBox, type Me } from "@/components/Shell";

export default function Verifica() {
  const router = useRouter();
  const { data: me, reload } = useApi<Me>("me");
  const [pin, setPin] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (me && !me.user) router.replace("/accedi");
    else if (me?.user?.verified) router.replace("/");
  }, [me, router]);

  if (!me?.user || me.user.verified) return <main className="muted">Caricamento…</main>;

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api("POST", "auth/verify", { pin })).then((ok) => ok && router.replace("/"));
  };
  const resend = () =>
    run(() => api("POST", "auth/resend")).then((ok) => ok && setNotice("Ti abbiamo inviato un nuovo PIN."));
  const change = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api("POST", "auth/change-email", { email: newEmail })).then((ok) => {
      if (!ok) return;
      setChanging(false);
      setNotice("Email aggiornata: ti abbiamo inviato un nuovo PIN.");
      reload();
    });
  };

  return (
    <main>
      <div className="logo">
        Lamento<span>metro</span>
      </div>
      <form className="card" onSubmit={verify}>
        <h2>Conferma la tua email</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Abbiamo inviato un PIN di 6 cifre a <b>{me.user.email}</b>. Scade tra 30 minuti. Controlla anche lo spam.
        </p>
        {notice && <p className="notice">{notice}</p>}
        <ErrorBox error={error} />
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input id="pin" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} required />
        </div>
        <button className="full" disabled={busy || pin.length < 6}>
          Conferma
        </button>
      </form>
      <div className="card stack">
        <button className="ghost full" disabled={busy} onClick={resend}>
          Inviami un nuovo PIN
        </button>
        {changing ? (
          <form className="row" onSubmit={change}>
            <input className="grow" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email corretta" required />
            <button disabled={busy}>Salva</button>
          </form>
        ) : (
          <button className="ghost full" onClick={() => setChanging(true)}>
            Ho sbagliato email
          </button>
        )}
        <button
          className="ghost full"
          onClick={async () => {
            await api("POST", "auth/logout");
            router.replace("/accedi");
          }}
        >
          Esci
        </button>
      </div>
    </main>
  );
}
