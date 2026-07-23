"use client";

import { signOut } from "next-auth/react";

interface Props {
  userid: string;
  email: string;
  role: string;
  initials: string;
  onClose: () => void;
}

export default function AccountPanel({ userid, email, role, initials, onClose }: Props) {
  function handleLogout() {
    signOut({ callbackUrl: "/login" });
  }

  const rolLabel = role === "beheerder" ? "Beheerder" : "Analist";

  return (
    <div className="chat-panel-area">
      <div className="chat-panel-wrap">
        <div className="chat-panel-page-title">
          Account
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--c-muted)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center" }} title="Sluiten">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="chat-panel-page-sub">
          Identiteit en beveiliging. Aanpassingen aan e-mail of wachtwoord lopen via de Wetsanalyse-app.
        </div>

        {/* Profiel */}
        <div className="chat-section">
          <div className="chat-section-header">
            <div className="chat-section-icon" style={{ background: "rgba(0,114,206,0.18)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="var(--c-neon)" strokeWidth="1.8" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="var(--c-neon)" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div className="chat-section-title">Profiel</div>
          </div>

          {/* Avatar */}
          <div className="chat-row" style={{ gap: 20 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, #003F8A, var(--c-blue))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.1rem", fontWeight: 800, color: "#fff",
              boxShadow: "0 0 20px rgba(0,114,206,0.40), 0 4px 12px rgba(0,0,0,0.4)",
              transform: "perspective(150px) rotateY(-6deg)",
            }}>
              {initials}
            </div>
            <div className="chat-row-left">
              <div className="chat-row-label" style={{ fontSize: "0.92rem", marginBottom: 4 }}>{userid}</div>
              <div className="chat-row-desc">{email}</div>
              <div style={{ marginTop: 6 }}>
                <span className="chat-status-active">
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--c-green)", display: "inline-block" }} />
                  {rolLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Gebruikersnaam</div>
              <div className="chat-row-desc">Inlog-identiteit — niet wijzigbaar via de assistent.</div>
            </div>
            <input className="chat-input-field chat-input-fixed" value={userid} readOnly />
          </div>

          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">E-mailadres</div>
              <div className="chat-row-desc">Wijzigen via de Wetsanalyse-webapp (/account).</div>
            </div>
            <input className="chat-input-field chat-input-fixed" value={email} readOnly />
          </div>
        </div>

        {/* Beveiliging */}
        <div className="chat-section">
          <div className="chat-section-header">
            <div className="chat-section-icon" style={{ background: "rgba(123,47,255,0.14)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#B97EFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="chat-section-title">Beveiliging</div>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Wachtwoord</div>
              <div className="chat-row-desc">Wijzig je wachtwoord via de Wetsanalyse-webapp.</div>
            </div>
            <a
              href={`${process.env.NEXT_PUBLIC_WEBAPP_URL ?? ""}/account#wachtwoord`}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-btn-ghost"
              style={{ fontSize: "0.72rem", textDecoration: "none" }}
            >
              Wachtwoord wijzigen
            </a>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Twee-factor-authenticatie</div>
              <div className="chat-row-desc">Beheer TOTP via de Wetsanalyse-webapp (/account).</div>
            </div>
            <a
              href={`${process.env.NEXT_PUBLIC_WEBAPP_URL ?? ""}/account#totp`}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-btn-ghost"
              style={{ fontSize: "0.72rem", textDecoration: "none" }}
            >
              2FA beheren
            </a>
          </div>
        </div>

        {/* Sessie */}
        <div className="chat-section">
          <div className="chat-section-header">
            <div className="chat-section-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M17 16l4-4m0 0l-4-4m4 4H7" stroke="var(--c-red)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13 4a9 9 0 11-6.36 2.64" stroke="var(--c-neon)" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div className="chat-section-title">Sessie</div>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Uitloggen</div>
              <div className="chat-row-desc">Je sessie-cookie wordt verwijderd. Lokale gespreksgeschiedenis blijft bewaard in je browser.</div>
            </div>
            <button className="chat-btn-ghost danger" onClick={handleLogout}>
              Uitloggen
            </button>
          </div>
          <div className="chat-row">
            <div className="chat-row-left" style={{ color: "var(--c-muted)", fontSize: "0.72rem" }}>
            Je gespreksgeschiedenis is bewaard in je browser (localStorage). Bij een andere browser of na het wissen van browserdata is de geschiedenis niet meer beschikbaar.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
