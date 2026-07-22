"use client";

import { useState } from "react";

type Taal = "nl";

interface Settings {
  reasoning: boolean;
  autoSources: boolean;
  streaming: boolean;
}

const DEFAULTS: Settings = {
  reasoning: true,
  autoSources: true,
  streaming: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("chat_settings");
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { return DEFAULTS; }
}

function saveSettings(s: Settings) {
  try { localStorage.setItem("chat_settings", JSON.stringify(s)); } catch { /* quota */ }
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    return loadSettings();
  });
  const [saved, setSaved] = useState(false);

  function update<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS(prev => ({ ...prev, [k]: v }));
    setSaved(false);
  }

  function handleSave() {
    saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="chat-panel-area">
      <div className="chat-panel-wrap">
        <div className="chat-panel-page-title">
          Instellingen
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--c-muted)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center" }} title="Sluiten">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="chat-panel-page-sub">
          Configureer het gedrag van de Juridische Assistent. Wijzigingen zijn alleen lokaal opgeslagen.
        </div>

        {/* Weergave */}
        <div className="chat-section">
          <div className="chat-section-header">
            <div className="chat-section-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="var(--c-neon)" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" stroke="var(--c-neon)" strokeWidth="1.8" />
              </svg>
            </div>
            <div>
              <div className="chat-section-title">Weergave</div>
            </div>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Redenering tonen</div>
              <div className="chat-row-desc">Toon het denkproces van de agent als uitklapbaar blok. Let op: dit kan de responstijd verlengen.</div>
            </div>
            <label className="chat-toggle">
              <input type="checkbox" checked={s.reasoning} onChange={e => update("reasoning", e.target.checked)} />
              <span className="chat-toggle-slider" />
            </label>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Bronnen automatisch tonen</div>
              <div className="chat-row-desc">Open het bronnen-paneel automatisch als het antwoord bronnen bevat.</div>
            </div>
            <label className="chat-toggle">
              <input type="checkbox" checked={s.autoSources} onChange={e => update("autoSources", e.target.checked)} />
              <span className="chat-toggle-slider" />
            </label>
          </div>
          <div className="chat-row">
            <div className="chat-row-left">
              <div className="chat-row-label">Streaming</div>
              <div className="chat-row-desc">Toon het antwoord terwijl het wordt gegenereerd.</div>
            </div>
            <label className="chat-toggle">
              <input type="checkbox" checked={s.streaming} onChange={e => update("streaming", e.target.checked)} />
              <span className="chat-toggle-slider" />
            </label>
          </div>
          <div className="chat-save-bar">
            <button className="chat-btn-ghost" onClick={() => { setS(DEFAULTS); setSaved(false); }}>Standaardwaarden</button>
            <button className="chat-btn-primary" onClick={handleSave}>
              {saved ? "Opgeslagen" : "Opslaan"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
