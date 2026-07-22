"use client";

import { signIn } from "next-auth/react";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

// Icoon: oog open
function IconEyeOpen() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

// Icoon: oog dicht (doorgestreept)
function IconEyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

type Stap = "credentials" | "totp";

export default function LoginPage() {
  const [stap, setStap] = useState<Stap>("credentials");
  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const totpRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!userid.trim() || !password) return;
    setLoading(true);
    setError("");

    try {
      const pre = await fetch("/api/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userid: userid.trim(), password }),
      });
      const preBody = await pre.json();

      if (pre.status === 429) {
        setError("Te veel pogingen. Probeer het over een minuut opnieuw.");
        return;
      }

      if (preBody.code === "totp_required") {
        // Ga naar TOTP-stap
        setStap("totp");
        setTotp("");
        setTimeout(() => totpRef.current?.focus(), 80);
        return;
      }

      if (!preBody.ok) {
        setError("Gebruikersnaam of wachtwoord is onjuist.");
        return;
      }

      // Geen 2FA nodig — direct inloggen
      await doSignIn();
    } catch {
      setError("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!totp.trim()) return;
    setLoading(true);
    setError("");
    try {
      await doSignIn(totp.trim());
    } catch {
      setError("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  async function doSignIn(totpCode?: string) {
    const res = await signIn("credentials", {
      userid: userid.trim(),
      password,
      ...(totpCode ? { totp: totpCode } : {}),
      redirect: false,
    });

    if (res?.ok) {
      router.replace("/chat");
    } else {
      if (stap === "totp") {
        setError("Verificatiecode onjuist. Probeer opnieuw.");
        setTotp("");
        setTimeout(() => totpRef.current?.focus(), 80);
      } else {
        setError("Inloggen mislukt. Controleer je gegevens.");
      }
    }
  }

  return (
    <div className="chat-auth-page">
      <div className="login-bg-grid" />
      <div className="login-bg-orb1" />
      <div className="login-bg-orb2" />

      <div className="chat-auth-card">
        {/* Logo / brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "linear-gradient(135deg, #0050A0, #00D4FF)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: "0.85rem", color: "#fff",
            boxShadow: "0 0 24px rgba(0,212,255,0.40), 0 4px 12px rgba(0,0,0,0.4)",
          }}>BD</div>
          <div>
            <div style={{ fontSize: "0.58rem", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--c-neon)" }}>Belastingdienst</div>
            <div style={{ fontSize: "0.80rem", fontWeight: 600, color: "var(--c-dim)" }}>Juridische Assistent</div>
          </div>
        </div>

        {stap === "credentials" ? (
          <>
            <div className="chat-auth-title">Inloggen</div>
            <div className="chat-auth-sub">Voer je inloggegevens in om toegang te krijgen tot de Juridische Assistent.</div>

            {error && <div className="chat-auth-error">{error}</div>}

            <form onSubmit={handleCredentials} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="chat-auth-label">Gebruikersnaam</label>
                <input
                  className="chat-input-field"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  value={userid}
                  onChange={e => setUserid(e.target.value)}
                  placeholder="jouw.naam"
                  disabled={loading}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label className="chat-auth-label">Wachtwoord</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="chat-input-field"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={loading}
                    style={{ width: "100%", paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    style={{
                      position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--c-muted)", padding: 2, display: "flex", alignItems: "center",
                    }}
                    title={showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen"}
                  >
                    {showPassword ? <IconEyeOff /> : <IconEyeOpen />}
                  </button>
                </div>
              </div>
              <button
                className="chat-auth-btn"
                type="submit"
                disabled={loading || !userid.trim() || !password}
                style={{ marginTop: 4 }}
              >
                {loading ? "Controleren…" : "Inloggen"}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="chat-auth-title">Verificatiecode</div>
            <div className="chat-auth-sub">
              Voer de 6-cijferige code uit je authenticator-app in voor <strong style={{ color: "var(--c-text)" }}>{userid}</strong>.
            </div>

            {error && <div className="chat-auth-error">{error}</div>}

            <form onSubmit={handleTotp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="chat-auth-label">Verificatiecode (TOTP)</label>
                <input
                  ref={totpRef}
                  className="chat-input-field"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  disabled={loading}
                  style={{ width: "100%", letterSpacing: "0.25em", fontSize: "1.1rem", textAlign: "center" }}
                  maxLength={6}
                />
              </div>
              <button
                className="chat-auth-btn"
                type="submit"
                disabled={loading || totp.length < 6}
                style={{ marginTop: 4 }}
              >
                {loading ? "Verifiëren…" : "Inloggen"}
              </button>
              <button
                type="button"
                onClick={() => { setStap("credentials"); setError(""); }}
                style={{
                  background: "none", border: "none", color: "var(--c-dim)",
                  fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline",
                  padding: 0,
                }}
              >
                Terug naar inloggen
              </button>
            </form>
          </>
        )}

        <hr className="chat-auth-divider" />
        <div className="chat-auth-tls">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="var(--c-dim)" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Beveiligde verbinding · TLS 1.3
        </div>
      </div>
    </div>
  );
}
