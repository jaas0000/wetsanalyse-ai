"use client";

import { useState } from "react";
import type { Source } from "@/lib/chat-types";

interface Props {
  sources: Source[];
  groundingOk: boolean | null;
  noCollapse?: boolean;
}

// Parseer een URI/label naar leesbare wet + artikel
function parseLabel(s: Source): { wet: string; artikel: string } {
  const raw = s.label ?? s.uri ?? s.iri ?? s.jci ?? "";

  // jci1.3:c:BWBR0002320&hoofdstuk=IV&artikel=20&...
  if (raw.startsWith("jci")) {
    const bwb = raw.match(/BWBR\d+/)?.[0] ?? "";
    const art = raw.match(/artikel=([^&]+)/)?.[1] ?? "";
    const lid = raw.match(/lid=([^&]+)/)?.[1];
    return {
      wet: s.wet ?? bwb,
      artikel: art ? `Art. ${art}${lid ? ` lid ${lid}` : ""}` : raw,
    };
  }

  // https://ipalm.nl/bwb/BWBR0002320/artikel/20/lid/1
  const m = raw.match(/\/(BWBR\d+)\/artikel\/([^/]+)(?:\/lid\/([^/]+))?/);
  if (m) {
    return {
      wet: s.wet ?? m[1],
      artikel: `Art. ${m[2]}${m[3] ? ` lid ${m[3]}` : ""}`,
    };
  }

  return { wet: s.wet ?? "", artikel: s.artikel ?? raw };
}

export function SourcesCard({ sources, groundingOk, noCollapse }: Props) {
  const [open, setOpen] = useState(noCollapse ?? false);

  if (!sources.length) return null;

  // Ontdubbel op label/uri
  const unique = sources.filter(
    (s, i, arr) =>
      arr.findIndex(x => (x.label ?? x.uri) === (s.label ?? s.uri)) === i
  );

  return (
    <div className={`chat-sources-card${open ? " open" : ""}${noCollapse ? " no-collapse" : ""}`}>
      {!noCollapse && (
        <div className="chat-sources-header" onClick={() => setOpen(v => !v)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--c-neon)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="chat-sources-title">Bronnen ({unique.length})</div>
          {groundingOk !== null && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: groundingOk ? "var(--c-green)" : "var(--c-orange)", display: "inline-block", flexShrink: 0 }} title={groundingOk ? "Gegrond" : "Onvolledig"} />
          )}
          <svg className="chat-sources-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      )}
      <div className="chat-sources-body">
        {unique.map((s, i) => {
          const { wet, artikel } = parseLabel(s);
          const href = s.uri?.startsWith("http") ? s.uri : undefined;
          return (
            <div className="chat-source-item" key={i}>
              <span className="chat-source-num">{i + 1}</span>
              <div>
                {wet && <div className="chat-source-wet">{wet}</div>}
                <div className="chat-source-art">
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--c-neon)", textDecoration: "none" }}>
                      {artikel}
                    </a>
                  ) : artikel}
                </div>
                {s.tekst && <div className="chat-source-cite">&ldquo;{s.tekst}&rdquo;</div>}
              </div>
            </div>
          );
        })}
        {groundingOk !== null && (
          <div className={`chat-grounding-chip ${groundingOk ? "" : "grounding-warn"}`}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: groundingOk ? "var(--c-green)" : "var(--c-orange)", display: "inline-block" }} />
            {groundingOk ? "Antwoord gegrond in bronnen" : "Bron-dekking onvolledig — verifieer"}
          </div>
        )}
      </div>
    </div>
  );
}

interface ReasonProps {
  text: string;
  defaultOpen?: boolean;
}

export function ReasonBlock({ text, defaultOpen = false }: ReasonProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text) return null;
  return (
    <div className={`chat-reason-block${open ? " open" : ""}`} onClick={() => setOpen(v => !v)}>
      <div className="chat-reason-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="#B97EFF" />
        </svg>
        <span>Redenering van de agent</span>
        <svg
          className="chat-reason-chevron"
          width="14" height="14" viewBox="0 0 24 24" fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="#B97EFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="chat-reason-body" style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </div>
    </div>
  );
}
