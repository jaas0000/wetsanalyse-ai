"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/chat-types";

interface Props {
  groups: { today: Conversation[]; yesterday: Conversation[]; week: Conversation[]; older: Conversation[] };
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  userName: string;
  userEmail: string;
  userInitials: string;
  userRole: string;
  onSettings: () => void;
  onAccount: () => void;
  onLogout: () => void;
  graphOnline: boolean | null;
  /** Sidebar is open op mobiel (off-canvas) */
  mobileOpen?: boolean;
}

// B1 — Toon tijd voor vandaag, dag+tijd voor gisteren/week, datum voor ouder
function convTimestamp(ms: number): string {
  const now = new Date();
  const startVandaag = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startGisteren = startVandaag - 86_400_000;
  const startWeek = startVandaag - 6 * 86_400_000;

  const d = new Date(ms);
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

  if (ms >= startVandaag) return time;
  if (ms >= startGisteren) return `gisteren ${time}`;
  if (ms >= startWeek) return d.toLocaleDateString("nl-NL", { weekday: "short" }) + " " + time;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function GroupSection({
  label, items, activeId, onSelect, onDelete,
}: {
  label: string;
  items: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <>
      <div className="chat-group-label" role="separator" aria-label={label}>{label}</div>
      {items.map(c => {
        const isActive = c.id === activeId;
        return (
          <div
            key={c.id}
            className={`chat-conv-item${isActive ? " active" : ""}`}
            role="button"
            tabIndex={0}
            aria-current={isActive ? "true" : undefined}
            aria-label={`Gesprek: ${c.title}`}
            onClick={() => onSelect(c.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(c.id);
              }
            }}
          >
            <div className="chat-conv-title">{c.title}</div>
            <div className="chat-conv-sub">{convTimestamp(c.updatedAt)}</div>
            <button
              className="chat-conv-delete"
              title="Gesprek verwijderen"
              aria-label={`Gesprek '${c.title}' verwijderen`}
              onClick={e => { e.stopPropagation(); onDelete(c.id); }}
              onKeyDown={e => e.stopPropagation()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        );
      })}
    </>
  );
}

export default function ChatSidebar(props: Props) {
  const { groups, activeId, onSelect, onNew, onDelete, userName, userEmail, userInitials, userRole, onSettings, onAccount, onLogout, graphOnline, mobileOpen } = props;

  return (
    <aside className={`chat-sidebar${mobileOpen ? " mobile-open" : ""}`} aria-label="Gesprekken">
      {/* Header / brand */}
      <div className="chat-sidebar-header">
        <button className="chat-brand" onClick={onNew} title="Naar beginscherm" aria-label="Belastingdienst Juridische Assistent — nieuw gesprek">
          <div className="chat-brand-mark" aria-hidden="true">BD</div>
          <div>
            <div className="chat-brand-org">Belastingdienst</div>
            <div className="chat-brand-name">Juridische Assistent</div>
          </div>
        </button>
        <button className="chat-new-btn" onClick={onNew} aria-label="Nieuw gesprek starten">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Nieuw gesprek
        </button>
      </div>

      {/* Conversation list */}
      <nav className="chat-conv-list" aria-label="Gesprekslijst">
        <GroupSection label="Vandaag" items={groups.today} activeId={activeId} onSelect={onSelect} onDelete={onDelete} />
        <GroupSection label="Gisteren" items={groups.yesterday} activeId={activeId} onSelect={onSelect} onDelete={onDelete} />
        <GroupSection label="Deze week" items={groups.week} activeId={activeId} onSelect={onSelect} onDelete={onDelete} />
        <GroupSection label="Ouder" items={groups.older} activeId={activeId} onSelect={onSelect} onDelete={onDelete} />
        {!groups.today.length && !groups.yesterday.length && !groups.week.length && !groups.older.length && (
          <p style={{ padding: "20px 8px", fontSize: "0.72rem", color: "var(--c-muted)", textAlign: "center", margin: 0 }}>
            Nog geen gesprekken.<br />Start een nieuw gesprek.
          </p>
        )}
      </nav>

      {/* Footer */}
      <div className="chat-sidebar-footer">
        <div className="chat-graph-status" aria-live="polite" aria-atomic="true">
          <span
            className={`chat-graph-dot${graphOnline === false ? " offline" : graphOnline === null ? " unknown" : ""}`}
            aria-hidden="true"
            style={
              graphOnline === false
                ? { background: "var(--c-red)", boxShadow: "0 0 8px rgba(255,58,92,0.5)" }
                : graphOnline === null
                ? { background: "var(--c-muted)", boxShadow: "none", animation: "none" }
                : {}
            }
          />
          <div>
            <div className="chat-graph-label" style={graphOnline === false ? { color: "var(--c-red)" } : graphOnline === null ? { color: "var(--c-muted)" } : {}}>
              {graphOnline === null ? "Verbinding controleren…" : graphOnline ? "Kennisgraaf online" : "Kennisgraaf offline"}
            </div>
            <div className="chat-graph-sub">BWB-triplestore · GraphDB</div>
          </div>
        </div>
        <UserBlock
          name={userName}
          email={userEmail}
          initials={userInitials}
          role={userRole}
          onSettings={onSettings}
          onAccount={onAccount}
          onLogout={onLogout}
        />
      </div>
    </aside>
  );
}

function UserBlock({ name, email, initials, role, onSettings, onAccount, onLogout }: {
  name: string; email: string; initials: string; role: string;
  onSettings: () => void; onAccount: () => void; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownId = "user-dropdown-menu";

  // Sluit bij klik buiten
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Sluit bij Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function handle(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <div ref={ref} className="chat-user-block-wrap">
      <button
        ref={triggerRef}
        className="chat-user-block"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={dropdownId}
        aria-label={`Gebruikersmenu voor ${name}`}
      >
        <div className="chat-avatar" aria-hidden="true">{initials}</div>
        <div className="chat-user-info">
          <div className="chat-user-name">{name}</div>
          <div className="chat-user-role">{role}</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={`chat-user-chevron${open ? " open" : ""}`} aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="var(--c-muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          id={dropdownId}
          className="chat-dropdown"
          role="menu"
          aria-label="Gebruikersmenu"
        >
          <div className="chat-dropdown-header" role="presentation">
            <div className="chat-dropdown-name">{name}</div>
            <div className="chat-dropdown-email">{email}</div>
          </div>
          <button className="chat-dropdown-item" role="menuitem" onClick={() => handle(onAccount)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Account
          </button>
          <button className="chat-dropdown-item" role="menuitem" onClick={() => handle(onSettings)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Instellingen
          </button>
          <div className="chat-dropdown-sep" role="separator" />
          <button className="chat-dropdown-item danger" role="menuitem" onClick={() => handle(onLogout)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Uitloggen
          </button>
        </div>
      )}
    </div>
  );
}
