"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  artifactOpen: boolean;
  hasArtifact: boolean;
  onArtifactToggle: () => void;
  /** Aanroepen als de gebruiker de gesprekstitel wijzigt. Alleen aanwezig bij een actief gesprek. */
  onRename?: (newTitle: string) => void;
  /** Toon de scroll-to-bottom knop */
  showScrollBtn?: boolean;
  onScrollToBottom?: () => void;
  /** Hamburger: sidebar openen op mobiel */
  onMenuOpen?: () => void;
}

export default function ChatTopbar({
  title,
  artifactOpen,
  hasArtifact,
  onArtifactToggle,
  onRename,
  showScrollBtn,
  onScrollToBottom,
  onMenuOpen,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    if (!onRename) return;
    setDraft(title);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  }

  function commitEdit() {
    if (draft.trim() && onRename) onRename(draft.trim());
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  }

  // Sluit edit bij klik buiten
  useEffect(() => {
    if (!editing) return;
    function handleMouseDown(e: MouseEvent) {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        commitEdit();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft]);

  return (
    <header className="chat-topbar">
      {/* Hamburger — alleen zichtbaar op mobiel via CSS */}
      {onMenuOpen && (
        <button
          className="chat-hamburger"
          onClick={onMenuOpen}
          aria-label="Menu openen"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      )}

      {/* Titel — klikbaar voor hernoemen als er een gesprek actief is */}
      <div className="chat-topbar-title-wrap">
        {editing ? (
          <input
            ref={inputRef}
            className="chat-topbar-rename-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={120}
            aria-label="Gesprekstitel bewerken"
          />
        ) : (
          <div
            className={`chat-topbar-title${onRename ? " editable" : ""}`}
            onClick={onRename ? startEdit : undefined}
            title={onRename ? "Klik om de titel te bewerken" : undefined}
          >
            {title || "Nieuw gesprek"}
            {onRename && title && (
              <svg
                className="chat-topbar-edit-icon"
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                aria-hidden="true"
              >
                <path
                  d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                />
                <path
                  d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Scroll-to-bottom knop */}
        {showScrollBtn && (
          <button
            className="chat-scroll-btn"
            onClick={onScrollToBottom}
            title="Scroll naar beneden"
            aria-label="Scroll naar beneden"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 15l7 7 7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Artifact-paneel toggle */}
        {hasArtifact && (
          <button
            className={`chat-artifact-btn ${artifactOpen ? "active" : ""}`}
            onClick={onArtifactToggle}
            title="Bronnen tonen/verbergen"
            aria-label={artifactOpen ? "Bronnen verbergen" : "Bronnen tonen"}
            aria-pressed={artifactOpen}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Bronnen
          </button>
        )}
      </div>
    </header>
  );
}
