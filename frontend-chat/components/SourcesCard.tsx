"use client";

import { useMemo, useState } from "react";
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

  // noCollapse = ArtifactPanel (zijpaneel heeft eigen header) → oude stijl
  if (noCollapse) {
    return (
      <div className="chat-sources-card no-collapse">
        <div className="chat-sources-body" style={{ display: "block", padding: "14px" }}>
          {unique.map((s, i) => {
            const { wet, artikel } = parseLabel(s);
            const href = s.uri?.startsWith("http") ? s.uri : undefined;
            return (
              <div className="chat-source-item" key={i}>
                <span className="chat-source-num">{i + 1}</span>
                <div className="chat-source-info">
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

  // Standaard: ReasonBlock-achtige groene inklapbare kaart
  return (
    <div className={`chat-sources-block${open ? " open" : ""}`} onClick={() => setOpen(v => !v)}>
      <div className="chat-sources-block-header">
        {/* Boek-icoon in groen */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="var(--c-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke="var(--c-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Bronnen ({unique.length})</span>
        {groundingOk !== null && (
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: groundingOk ? "var(--c-green)" : "var(--c-orange)", display: "inline-block", flexShrink: 0 }}
            title={groundingOk ? "Gegrond" : "Onvolledig"}
          />
        )}
        <svg className="chat-sources-block-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="var(--c-green)" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="chat-sources-block-body">
        {unique.map((s, i) => {
          const { wet, artikel } = parseLabel(s);
          const href = s.uri?.startsWith("http") ? s.uri : undefined;
          return (
            <div className="chat-source-item" key={i}>
              <span className="chat-source-num">{i + 1}</span>
              <div className="chat-source-info">
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
          <div className={`chat-grounding-chip ${groundingOk ? "" : "grounding-warn"}`} style={{ marginTop: 10 }}>
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
  /** Wanneer true: blok standaard dicht, tekst in DOM beperkt tot 2000 chars
   *  om layout-reflows (pre-wrap rewrap, 20×/sec) te voorkomen. */
  isStreaming?: boolean;
}

// Maximale DOM-tekst tijdens streaming — voorkomt dat de browser 16 000+ chars
// per-wrap opnieuw herbreekt bij elke 50ms-flush. De volledige tekst blijft in
// React state; na afronden wordt hij in één keer volledig getoond.
const STREAMING_DOM_CAP = 2000;

export function ReasonBlock({ text, defaultOpen = false, isStreaming = false }: ReasonProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (!text) return null;

  // Fix 3: beperk DOM-tekst tijdens streaming tot de laatste STREAMING_DOM_CAP chars.
  // useMemo herberekent alleen als text of isStreaming wijzigt.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const displayText = useMemo(() => {
    if (!isStreaming || text.length <= STREAMING_DOM_CAP) return text;
    return "…" + text.slice(-STREAMING_DOM_CAP);
  }, [text, isStreaming]);

  return (
    <div className={`chat-reason-block${open ? " open" : ""}`} onClick={() => setOpen(v => !v)}>
      <div className="chat-reason-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="#B97EFF" />
        </svg>
        <span>Redenering van de agent</span>
        {isStreaming && (
          // Subtiele indicator dat er nog tekst binnenstroomt
          <span style={{ marginLeft: 4, fontSize: "0.65rem", color: "var(--c-neon)", opacity: 0.7 }}>
            live
          </span>
        )}
        <svg
          className="chat-reason-chevron"
          width="14" height="14" viewBox="0 0 24 24" fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="#B97EFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="chat-reason-body" style={{ whiteSpace: "pre-wrap" }}>
        {displayText}
      </div>
    </div>
  );
}
