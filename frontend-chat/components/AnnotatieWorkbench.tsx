"use client";

import { useRef, useState } from "react";
import type { AnnotatieElement, AnnotatieDoel, OntbrekendItem } from "@/lib/chat-types";

// JAS-klasse → compacte afkorting + kleur
const JAS_META: Record<string, { kort: string; kleur: string }> = {
  "Rechtssubject":                       { kort: "RS",  kleur: "#0072CE" },
  "Rechtsobject":                        { kort: "RO",  kleur: "#007B5E" },
  "Rechtsbetrekking":                    { kort: "RB",  kleur: "#9B59B6" },
  "Rechtsfeit":                          { kort: "RF",  kleur: "#E67E22" },
  "Voorwaarde":                          { kort: "VW",  kleur: "#C0392B" },
  "Afleidingsregel":                     { kort: "AR",  kleur: "#16A085" },
  "Variabele en variabelewaarde":        { kort: "VV",  kleur: "#2980B9" },
  "Parameter en parameterwaarde":        { kort: "PP",  kleur: "#8E44AD" },
  "Operator":                            { kort: "OP",  kleur: "#D35400" },
  "Tijdsaanduiding":                     { kort: "TA",  kleur: "#27AE60" },
  "Plaatsaanduiding":                    { kort: "PA",  kleur: "#1ABC9C" },
  "Delegatiebevoegdheid en delegatie-invulling": { kort: "DB", kleur: "#F39C12" },
  "Brondefinitie":                       { kort: "BD",  kleur: "#95A5A6" },
};

const AANDACHT_META = {
  groen: { label: "Akkoord", kleur: "#27AE60", icon: "✓" },
  geel:  { label: "Aandacht", kleur: "#F39C12", icon: "!" },
  rood:  { label: "Twijfel", kleur: "#C0392B", icon: "?" },
  "":    { label: "–", kleur: "var(--c-muted)", icon: "–" },
};

function buildAnnotatedHtml(
  tekst: string,
  elementen: AnnotatieElement[],
  actiefIdx: number | null
): string {
  if (!elementen.length) return escHtml(tekst).replace(/\n/g, "<br/>");

  // Verzamel alle geldige spans met hun element-index
  type SpanItem = { s: number; e: number; el: AnnotatieElement; i: number };
  const items: SpanItem[] = [];
  elementen.forEach((el, i) => {
    if (!el.span || el.span[1] <= el.span[0]) return;
    items.push({ s: el.span[0], e: el.span[1], el, i });
  });
  if (!items.length) return escHtml(tekst).replace(/\n/g, "<br/>");

  // Sorteer op startpositie, bij gelijke start langste span eerst
  items.sort((a, b) => a.s - b.s || (b.e - a.e));

  // Merge overlappende/aangrenzende spans tot groepen
  type Group = { s: number; e: number; items: SpanItem[] };
  const groups: Group[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && item.s < last.e) {
      last.e = Math.max(last.e, item.e);
      last.items.push(item);
    } else {
      groups.push({ s: item.s, e: item.e, items: [item] });
    }
  }

  const parts: string[] = [];
  let pos = 0;

  for (const { s, e, items: grpItems } of groups) {
    // Escape het tekstfragment vóór de mark (span-indices op originele tekst)
    if (s > pos) parts.push(escHtml(tekst.slice(pos, s)).replace(/\n/g, "<br/>"));

    const isGroepActief = grpItems.some(x => x.i === actiefIdx);
    const heeftFeedback = grpItems.some(x => x.el.feedback);
    const opacity = actiefIdx !== null && !isGroepActief ? "0.4" : "1";

    // Bouw badges — één per element, elk met eigen data-idx voor klik
    const badges = grpItems.map(({ el, i }) => {
      const meta = JAS_META[el.klasse] ?? { kort: "?", kleur: "#999" };
      const outline = i === actiefIdx ? `outline:2px solid ${meta.kleur};outline-offset:1px;` : "";
      return `<sup class="jas-badge" data-idx="${i}" style="background:${meta.kleur};${outline}cursor:pointer;" title="${escAttr(el.klasse)}">${meta.kort}</sup>`;
    }).join("");

    const firstMeta = JAS_META[grpItems[0].el.klasse] ?? { kleur: "#999" };
    const colors = grpItems.map(x => JAS_META[x.el.klasse]?.kleur ?? "#999");
    const borderBottom = colors.length === 1
      ? `border-bottom:2px solid ${colors[0]}`
      : `border-bottom:3px solid ${colors[0]};border-image:linear-gradient(to right,${colors.join(",")}) 1`;

    const markIdx = grpItems.length === 1 ? `data-idx="${grpItems[0].i}"` : "";

    // Escape het gemarkeerde fragment afzonderlijk (indices op originele tekst)
    parts.push(
      `<mark class="jas-mark${heeftFeedback ? " has-feedback" : ""}" ${markIdx} style="background:${firstMeta.kleur}1A;${borderBottom};opacity:${opacity};">` +
      escHtml(tekst.slice(s, e)) +
      badges +
      `</mark>`
    );
    pos = e;
  }

  if (pos < tekst.length) parts.push(escHtml(tekst.slice(pos)).replace(/\n/g, "<br/>"));
  return parts.join("");
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string) {
  return s.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

interface Props {
  doel: AnnotatieDoel;
  elementen: AnnotatieElement[];
  ontbrekend: OntbrekendItem[];
  isStreaming: boolean;
  // callback om feedback op te slaan (idx, status, notitie)
  onFeedback: (idx: number, feedback: "akkoord" | "afwijzen" | "twijfel", notitie: string) => void;
}

export default function AnnotatieWorkbench({ doel, elementen, ontbrekend, isStreaming, onFeedback }: Props) {
  const [actiefIdx, setActiefIdx] = useState<number | null>(null);
  const [notities, setNotities] = useState<Record<number, string>>({});
  const elementRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tekstRef = useRef<HTMLDivElement>(null);

  const corpusTekst = doel.leden_teksten.map(l => l.tekst).join("\n\n");
  const annoHtml = buildAnnotatedHtml(corpusTekst, elementen, actiefIdx);

  function selecteer(idx: number) {
    setActiefIdx(prev => prev === idx ? null : idx);
    // scroll element-kaart in beeld
    setTimeout(() => {
      elementRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function handleMarkClick(e: React.MouseEvent<HTMLDivElement>) {
    const mark = (e.target as HTMLElement).closest("[data-idx]");
    if (mark) {
      const idx = parseInt((mark as HTMLElement).dataset.idx ?? "-1");
      if (!isNaN(idx)) selecteer(idx);
    }
  }

  function geefFeedback(idx: number, fb: "akkoord" | "afwijzen" | "twijfel") {
    onFeedback(idx, fb, notities[idx] ?? "");
    setActiefIdx(null);
  }

  function kiesAlternatief(idx: number, klasseNaam: string, motivatie?: string) {
    const notitie = `Alternatief gekozen: ${klasseNaam}${motivatie ? ` — ${motivatie}` : ""}`;
    setNotities(prev => ({ ...prev, [idx]: notitie }));
    onFeedback(idx, "twijfel", notitie);
    // Sluit na de parent re-render om state-conflict te vermijden
    setTimeout(() => setActiefIdx(null), 0);
  }

  const groene = elementen.filter(e => e.aandacht === "groen").length;
  const gele   = elementen.filter(e => e.aandacht === "geel").length;
  const rode   = elementen.filter(e => e.aandacht === "rood").length;
  const akkoord  = elementen.filter(e => e.feedback === "akkoord").length;
  const afgewezen = elementen.filter(e => e.feedback === "afwijzen").length;
  const beoordeeld = elementen.filter(e => !!e.feedback).length;
  const alleBeoordeeld = elementen.length > 0 && beoordeeld === elementen.length;

  const titel = doel.citeertitel
    ? `${doel.citeertitel} art. ${doel.artikel}`
    : `${doel.bwbId} art. ${doel.artikel}`;

  return (
    <div className="annot-root">
      {/* Header */}
      <div className="annot-header">
        <div className="annot-header-title">
          <span className="annot-header-wet">{titel}</span>
          {doel.lid && <span className="annot-header-lid">lid {doel.lid}</span>}
          {isStreaming && <span className="annot-streaming-dot" title="Analyse bezig…" />}
        </div>
        <div className="annot-stats">
          <span className="annot-stat" style={{ color: "#27AE60" }}>{groene} groen</span>
          <span className="annot-stat" style={{ color: "#F39C12" }}>{gele} aandacht</span>
          <span className="annot-stat" style={{ color: "#C0392B" }}>{rode} twijfel</span>
          <span className="annot-stat-sep" />
          <span className="annot-stat" style={{ color: "var(--c-muted)" }}>{akkoord} ✓ &nbsp;{afgewezen} ✗</span>
          <span className="annot-stat-sep" />
          <span className="annot-stat" style={{ color: alleBeoordeeld ? "#27AE60" : "var(--c-muted)", fontWeight: alleBeoordeeld ? 700 : 400 }}>
            {beoordeeld}/{elementen.length} beoordeeld
          </span>
        </div>
      </div>

      <div className="annot-body">
        {/* Links: wettekst met markeringen */}
        <div className="annot-tekst-wrap">
          <div className="annot-tekst-label">Wettekst</div>
          <div
            ref={tekstRef}
            className="annot-tekst"
            onClick={handleMarkClick}
            dangerouslySetInnerHTML={{ __html: annoHtml }}
          />
        </div>

        {/* Rechts: elementenlijst */}
        <div className="annot-lijst-wrap">
          <div className="annot-tekst-label">
            JAS-elementen ({elementen.length})
            {actiefIdx !== null && (
              <button className="annot-desel-btn" onClick={() => setActiefIdx(null)}>
                Deselecteer
              </button>
            )}
          </div>
          <div className="annot-lijst">
            {elementen.length === 0 && isStreaming && (
              <div className="annot-skeleton-wrap" aria-live="polite" aria-label="Elementen worden geïdentificeerd">
                <span className="annot-skeleton-dot" />
                <span className="annot-skeleton-text">Elementen worden geïdentificeerd…</span>
              </div>
            )}
            {elementen.map((el, i) => {
              const meta  = JAS_META[el.klasse] ?? { kort: "?", kleur: "#999" };
              const amd   = AANDACHT_META[el.aandacht || ""] ?? AANDACHT_META[""];
              const isAct = i === actiefIdx;
              const fb    = el.feedback;
              return (
                <div
                  key={i}
                  ref={ref => { elementRefs.current[i] = ref; }}
                  className={`annot-el-card${isAct ? " actief" : ""}${fb ? ` fb-${fb}` : ""}`}
                  style={{ borderLeftColor: meta.kleur }}
                  onClick={() => selecteer(i)}
                >
                  {/* Kaart-header */}
                  <div className="annot-el-head">
                    <span className="annot-el-badge" style={{ background: meta.kleur }}>{meta.kort}</span>
                    <span className="annot-el-klasse">{el.klasse}</span>
                    <span className="annot-el-aandacht" style={{ color: amd.kleur }} title={el.critic}>
                      {amd.icon}
                    </span>
                    {fb && (
                      <span className={`annot-el-fb-chip annot-el-fb-${fb}`}>
                        {fb === "akkoord" ? "✓ Akkoord" : fb === "afwijzen" ? "✗ Afwijzen" : "~ Twijfel"}
                      </span>
                    )}
                  </div>

                  {/* Fragment */}
                  <div className="annot-el-tekst">&ldquo;{el.tekst}&rdquo;</div>

                  {/* Details — alleen zichtbaar als actief */}
                  {isAct && (
                    <div className="annot-el-detail" onClick={e => e.stopPropagation()}>
                      {el.toelichting && (
                        <div className="annot-el-toelichting">{el.toelichting}</div>
                      )}
                      {el.critic && (
                        <div className="annot-el-critic" style={{ color: amd.kleur }}>
                          <strong>{amd.label}:</strong> {el.critic}
                        </div>
                      )}
                      {el.alternatieven.length > 0 && (
                        <div className="annot-el-alts">
                          <div className="annot-el-alts-label">Alternatieven — klik om te kiezen</div>
                          {el.alternatieven.map((a, ai) => (
                            <div
                              key={ai}
                              className="annot-el-alt annot-el-alt-klikbaar"
                              title="Klik om dit alternatief te kiezen"
                              onClick={e => { e.stopPropagation(); kiesAlternatief(i, a.klasse, a.motivatie); }}
                            >
                              <span className="annot-el-badge sm" style={{ background: JAS_META[a.klasse]?.kleur ?? "#999" }}>
                                {JAS_META[a.klasse]?.kort ?? "?"}
                              </span>
                              <span>{a.klasse}</span>
                              {a.motivatie && <span className="annot-el-alt-mot"> — {a.motivatie}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Feedback-knoppen */}
                      <div className="annot-el-feedback-wrap">
                        <button
                          className={`annot-fb-btn akkoord${fb === "akkoord" ? " actief" : ""}`}
                          onClick={() => geefFeedback(i, "akkoord")}
                        >✓ Akkoord</button>
                        <button
                          className={`annot-fb-btn twijfel${fb === "twijfel" ? " actief" : ""}`}
                          onClick={() => geefFeedback(i, "twijfel")}
                        >~ Twijfel</button>
                        <button
                          className={`annot-fb-btn afwijzen${fb === "afwijzen" ? " actief" : ""}`}
                          onClick={() => geefFeedback(i, "afwijzen")}
                        >✗ Afwijzen</button>
                      </div>
                      <textarea
                        className="annot-el-notitie"
                        placeholder="Optionele notitie…"
                        value={notities[i] ?? ""}
                        onChange={e => setNotities(prev => ({ ...prev, [i]: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Afsluitsignaal als alle elementen beoordeeld zijn */}
          {alleBeoordeeld && !isStreaming && (
            <div style={{
              margin: "12px 0 4px",
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(39,174,96,0.10)",
              border: "1px solid rgba(39,174,96,0.28)",
              color: "#27AE60",
              fontSize: "0.76rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#27AE60" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Alle {elementen.length} elementen beoordeeld
            </div>
          )}

          {/* Ontbrekend */}
          {ontbrekend.length > 0 && (
            <div className="annot-ontbrekend">
              <div className="annot-tekst-label">Mogelijk ontbrekend ({ontbrekend.length})</div>
              {ontbrekend.map((o, i) => {
                const meta = JAS_META[o.klasse] ?? { kort: "?", kleur: "#999" };
                return (
                  <div key={i} className="annot-ontbr-item">
                    <div className="annot-ontbr-head">
                      <span className="annot-el-badge sm" style={{ background: meta.kleur }}>{meta.kort}</span>
                      <span className="annot-ontbr-klasse">{o.klasse}</span>
                    </div>
                    {o.reden && <span className="annot-ontbr-reden">{o.reden}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
