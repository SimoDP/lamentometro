"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, useAction } from "@/components/client";
import { ErrorBox } from "@/components/Shell";

type Mode = "login" | "register" | "forgot" | "reset";

export default function Accedi() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const { busy, error, setError, run } = useAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === "login") await api("POST", "auth/login", { email, password });
      else if (mode === "register") {
        await api("POST", "auth/register", { email, username, password });
        router.replace("/verifica");
        return;
      }
      else if (mode === "forgot") {
        await api("POST", "auth/forgot", { email });
        setMode("reset");
        return;
      } else await api("POST", "auth/reset", { email, pin, password });
      router.replace("/");
    });
  };

  const go = (m: Mode) => {
    setError(null);
    setMode(m);
  };

  return (
    <main>
      <div className="logo">
        Lamento<span>metro</span>
      </div>
      <p className="sub" style={{ textAlign: "center" }}>
        Chi si lamenta di più, paga pegno.
      </p>
      {(mode === "login" || mode === "register") && (
        <div className="tabs">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => go("login")}>
            Accedi
          </button>
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => go("register")}>
            Registrati
          </button>
        </div>
      )}
      <form className="card" onSubmit={submit}>
        {mode === "forgot" && <h2>Password dimenticata</h2>}
        {mode === "reset" && (
          <>
            <h2>Nuova password</h2>
            <p className="notice">Se l&apos;email è registrata ti abbiamo inviato un PIN di 6 cifre. Scade tra 15 minuti.</p>
            <div style={{ height: 12 }} />
          </>
        )}
        <ErrorBox error={error} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode === "register" && (
          <div className="field">
            <label htmlFor="username">Nome utente (serve all&apos;altra persona per trovarti)</label>
            <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
        )}
        {mode === "reset" && (
          <div className="field">
            <label htmlFor="pin">PIN</label>
            <input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} required />
          </div>
        )}
        {mode !== "forgot" && (
          <div className="field">
            <label htmlFor="password">{mode === "reset" ? "Nuova password" : "Password"}</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "login" ? undefined : 8}
            />
          </div>
        )}
        <button className="full" disabled={busy}>
          {mode === "login" ? "Accedi" : mode === "register" ? "Crea account" : mode === "forgot" ? "Inviami il PIN" : "Salva e accedi"}
        </button>
      </form>
      <p style={{ textAlign: "center" }}>
        {mode === "login" ? (
          <a href="#" onClick={(e) => (e.preventDefault(), go("forgot"))}>
            Password dimenticata?
          </a>
        ) : mode !== "register" ? (
          <a href="#" onClick={(e) => (e.preventDefault(), go("login"))}>
            Torna all&apos;accesso
          </a>
        ) : null}
      </p>
    </main>
  );
}
