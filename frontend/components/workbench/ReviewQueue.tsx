"use client";

import { useState } from "react";

import { AdviesDraadje } from "@/components/workbench/AdviesDraadje";
import { JAS_KLASSEN, jasStyle } from "@/lib/jas";
import type { AnnotatieElement, BeslissingInvoer, ReviewReason } from "@/lib/types";

const REDENEN: { waarde: ReviewReason; label: string }[] = [
  { waarde: "verkeerde_klasse", label: "verkeerde klasse" },
  { waarde: "bron_gemist", label: "bron gemist" },
  { waarde: "tekst", label: "tekst onjuist" },
  { waarde: "interpretatie", label: "interpretatie" },
  { waarde: "onvoldoende_context", label: "onvoldoende context" },
  { waarde: "anders", label: "anders" },
];

const LIFECYCLE_LABEL: Record<string, string> = {
  voorgesteld: "voorgesteld",
  critic_checked: "te reviewen",
  human_approved: "akkoord",
  edited: "aangepast",
  rejected: "verworpen",
};

// Aandacht-niveau (🟢🟡🔴) is de dragende visuele as: het kleurt de linker-accentrand + een zachte
// tint. Alle kleuren via de aandacht-design-tokens (geen rauwe Tailwind-kleuren buiten de huisstijl).
const AANDACHT: Record<string, { emoji: string; label: string; rand: string; tint: string }> = {
  groen: { emoji: "🟢", label: "groen — geen bezwaar", rand: "border-l-aandacht-groen-rand", tint: "bg-aandacht-groen-bg/40" },
  geel: { emoji: "🟡", label: "geel — even kijken", rand: "border-l-aandacht-geel-rand", tint: "bg-aandacht-geel-bg/40" },
  rood: { emoji: "🔴", label: "rood — waarschijnlijk fout", rand: "border-l-aandacht-rood-rand", tint: "bg-aandacht-rood-bg/40" },
};

const BESLIST = ["human_approved", "edited", "rejected"];

// Actieknoppen via de functionele tokens (geen emerald/sky/rose): akkoord = succes, aanpassen = info,
// verwerpen = fout.
const KNOP_SUCCES = "bg-succes text-paper hover:brightness-110";
const KNOP_INFO = "bg-info text-paper hover:brightness-110";
const KNOP_FOUT = "bg-fout text-paper hover:brightness-110";
const KNOP_BASIS = "rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50";

type Actie = "reject" | "edit" | "comment" | null;

function DecisionCard({
  el,
  actief,
  onKies,
  onBeslissing,
  onAdvies,
}: {
  el: AnnotatieElement;
  actief: boolean;
  onKies: () => void;
  onBeslissing: (req: BeslissingInvoer) => Promise<void>;
  /** Vraag de assistent om uitleg bij dít element. Weglaten verbergt het draadje. */
  onAdvies?: (el: AnnotatieElement, vraag: string, opToken: (t: string) => void) => Promise<void>;
}) {
  const [actie, setActie] = useState<Actie>(null);
  const [reden, setReden] = useState<ReviewReason>("interpretatie");
  const [comment, setComment] = useState("");
  const [klasse, setKlasse] = useState(el.klasse);
  const [toelichting, setToelichting] = useState(el.toelichting);
  const [bezig, setBezig] = useState(false);

  // "beslist" = de mens heeft al een besluit genomen; `voorgesteld`/`critic_checked` zijn nog te reviewen.
  const beslist = BESLIST.includes(el.lifecycle);
  const aandacht = el.aandacht ? AANDACHT[el.aandacht] : null;

  async function verstuur(req: BeslissingInvoer) {
    setBezig(true);
    try {
      await onBeslissing(req);
      setActie(null);
    } finally {
      setBezig(false);
    }
  }

  return (
    <div
      onClick={onKies}
      className={`rounded-kaart border border-line border-l-4 bg-white p-3 shadow-zacht transition ${
        beslist ? "opacity-75" : aandacht ? `${aandacht.rand} ${aandacht.tint}` : "border-l-line"
      } ${actief ? "border-lint ring-1 ring-lint" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {el.aandacht && (
            <span title={el.critic || aandacht?.label} aria-label={aandacht?.label}>
              {aandacht?.emoji}
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${jasStyle(el.klasse)}`}>{el.klasse}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-muted">
          {beslist && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-succes" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
          {LIFECYCLE_LABEL[el.lifecycle] ?? el.lifecycle}
          {el.lid ? ` · lid ${el.lid}` : ""}
        </span>
      </div>
      <p className="mt-2 border-l-2 border-line pl-2.5 text-sm italic text-ink">“{el.tekst}”</p>
      {el.toelichting && <p className="mt-1.5 text-xs text-muted">{el.toelichting}</p>}
      {el.critic && <p className="mt-1 text-xs italic text-muted">Critic: {el.critic}</p>}

      {/* Kanttekening bij een markering die de JURIST zelf maakte. Bewust een ander vorm dan een
          decision-card: dit is advies dat je naast je neer mag leggen, geen voorstel om te beoordelen.
          Accepteren wordt een `edit` (de klasse wijzigt), afwijzen een `comment` — zo blijft in het
          auditspoor staan dát de Critic iets vond en wat jij daarmee deed. */}
      {el.critic_suggestie?.motivatie && el.critic_suggestie.status === "open" && (
        <div
          className="mt-2 rounded-kaart border border-dashed border-line bg-surface p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-muted">
            <span className="font-medium text-ink">Kanttekening van de assistent:</span>{" "}
            {el.critic_suggestie.motivatie}
            {el.critic_suggestie.voorstel_klasse && (
              <> Voorstel: <span className={`rounded px-1 ${jasStyle(el.critic_suggestie.voorstel_klasse)}`}>
                {el.critic_suggestie.voorstel_klasse}
              </span></>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {el.critic_suggestie.voorstel_klasse && (
              <button
                disabled={bezig}
                onClick={() =>
                  verstuur({
                    type: "edit",
                    review_reason: "verkeerde_klasse",
                    comment: "Kanttekening van de assistent overgenomen.",
                    wijziging: { klasse: el.critic_suggestie!.voorstel_klasse },
                  })
                }
                className={`${KNOP_BASIS} ${KNOP_SUCCES}`}
              >
                Overnemen
              </button>
            )}
            <button
              disabled={bezig}
              onClick={() =>
                verstuur({ type: "comment", comment: "Kanttekening van de assistent afgewezen." })
              }
              className={`${KNOP_BASIS} ${KNOP_INFO}`}
            >
              Naast me neerleggen
            </button>
          </div>
        </div>
      )}
      {el.alternatieven.length > 0 &&
        (beslist ? (
          <p className="mt-1 text-xs text-muted">Twijfel: {el.alternatieven.map((a) => a.klasse).join(", ")}</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
            <span>Twijfel — kies om te wijzigen:</span>
            {el.alternatieven.map((a) => (
              <button
                key={a.klasse}
                title={a.motivatie}
                onClick={() => {
                  setKlasse(a.klasse);
                  setReden("verkeerde_klasse");
                  setActie("edit");
                }}
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${jasStyle(a.klasse)} hover:ring-1 hover:ring-lint`}
              >
                {a.klasse}
              </button>
            ))}
          </div>
        ))}

      {onAdvies && <AdviesDraadje onVraag={(v, opToken) => onAdvies(el, v, opToken)} />}

      {!beslist && actie === null && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button disabled={bezig} onClick={() => verstuur({ type: "approve" })} className={`${KNOP_BASIS} ${KNOP_SUCCES}`}>
            Akkoord
          </button>
          <button
            onClick={() => {
              // Reset naar de actuele waarden zodat een eerder geannuleerde bewerking niet blijft hangen.
              setKlasse(el.klasse);
              setToelichting(el.toelichting);
              setActie("edit");
            }}
            className={`${KNOP_BASIS} ${KNOP_INFO}`}
          >
            Aanpassen
          </button>
          <button onClick={() => setActie("reject")} className={`${KNOP_BASIS} ${KNOP_FOUT}`}>
            Verwerpen
          </button>
          <button
            onClick={() => {
              setComment("");
              setActie("comment");
            }}
            className={`${KNOP_BASIS} border border-line text-ink hover:bg-surface`}
          >
            Opmerking
          </button>
        </div>
      )}

      {actie === "reject" && (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <RedenSelect reden={reden} setReden={setReden} />
          <div className="flex gap-1.5">
            <button disabled={bezig} onClick={() => verstuur({ type: "reject", review_reason: reden })} className={`${KNOP_BASIS} ${KNOP_FOUT}`}>
              Verwerpen
            </button>
            <AnnuleerKnop onClick={() => setActie(null)} />
          </div>
        </div>
      )}

      {actie === "edit" && (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <select
            value={klasse}
            onChange={(e) => setKlasse(e.target.value)}
            className="w-full rounded-field border border-line px-2 py-1.5 text-xs"
          >
            {JAS_KLASSEN.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={toelichting}
            onChange={(e) => setToelichting(e.target.value)}
            placeholder="Toelichting"
            className="w-full rounded-field border border-line px-2 py-1.5 text-xs"
          />
          <RedenSelect reden={reden} setReden={setReden} />
          <div className="flex gap-1.5">
            <button
              disabled={bezig}
              onClick={() => verstuur({ type: "edit", review_reason: reden, wijziging: { klasse, toelichting } })}
              className={`${KNOP_BASIS} ${KNOP_INFO}`}
            >
              Opslaan
            </button>
            <AnnuleerKnop onClick={() => setActie(null)} />
          </div>
        </div>
      )}

      {actie === "comment" && (
        <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Opmerking"
            className="w-full rounded-field border border-line px-2 py-1.5 text-xs"
          />
          <div className="flex gap-1.5">
            <button
              disabled={bezig || !comment.trim()}
              onClick={() => verstuur({ type: "comment", comment })}
              className={`${KNOP_BASIS} bg-lint text-paper hover:bg-accent-soft`}
            >
              Plaatsen
            </button>
            <AnnuleerKnop onClick={() => setActie(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function RedenSelect({ reden, setReden }: { reden: ReviewReason; setReden: (r: ReviewReason) => void }) {
  return (
    <select
      value={reden}
      onChange={(e) => setReden(e.target.value as ReviewReason)}
      className="w-full rounded-field border border-line px-2 py-1.5 text-xs"
    >
      {REDENEN.map((r) => (
        <option key={r.waarde} value={r.waarde}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

function AnnuleerKnop({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${KNOP_BASIS} border border-line text-muted hover:bg-surface`}>
      Annuleren
    </button>
  );
}

export function ReviewQueue({
  elementen,
  actiefId,
  onKies,
  onBeslissing,
  onAdvies,
}: {
  elementen: AnnotatieElement[];
  actiefId?: string;
  onKies: (id?: string) => void;
  onBeslissing: (elementId: string, req: BeslissingInvoer) => Promise<void>;
  onAdvies?: (el: AnnotatieElement, vraag: string, opToken: (t: string) => void) => Promise<void>;
}) {
  const telling = elementen.reduce<Record<string, number>>((acc, el) => {
    acc[el.lifecycle] = (acc[el.lifecycle] ?? 0) + 1;
    return acc;
  }, {});
  const totaal = elementen.length;
  const beslist = elementen.filter((el) => BESLIST.includes(el.lifecycle)).length;
  const teReviewen = (telling.voorgesteld ?? 0) + (telling.critic_checked ?? 0);
  const perc = totaal ? Math.round((beslist / totaal) * 100) : 0;
  const afgerond = totaal > 0 && beslist === totaal;

  return (
    <div className="space-y-2.5">
      {/* Voortgang: hoeveel van de N elementen zijn beoordeeld, met een dunne balk. */}
      <div className="rounded-kaart border border-line bg-surface px-3 py-2.5 shadow-zacht">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink">
            Review — {beslist}/{totaal} beoordeeld
          </span>
          {afgerond ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-aandacht-groen-bg px-2 py-0.5 text-[0.65rem] font-semibold text-aandacht-groen-tekst">
              ✓ Review afgerond
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[0.65rem] text-muted">
              {teReviewen > 0 && <span>🟡 {teReviewen}</span>}
              {telling.human_approved ? <span>🟢 {telling.human_approved}</span> : null}
              {telling.rejected ? <span>🔴 {telling.rejected}</span> : null}
            </span>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60" role="progressbar" aria-valuenow={perc} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all ${afgerond ? "bg-succes" : "bg-lint"}`} style={{ width: `${perc}%` }} />
        </div>
      </div>

      {elementen.map((el) => (
        <DecisionCard
          key={el.id}
          el={el}
          actief={el.id === actiefId}
          onKies={() => onKies(el.id)}
          onBeslissing={(req) => onBeslissing(el.id, req)}
          onAdvies={onAdvies}
        />
      ))}
    </div>
  );
}
