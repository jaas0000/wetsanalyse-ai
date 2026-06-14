"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { JasBadge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Field";
import { getRonde, sendFeedback, isApiError } from "@/lib/api";
import type { Analyse2, Analyse3, Feedback, Job } from "@/lib/types";

interface ReviewItem {
  id: string;
  titel: string;
  klasse?: string;
  regels: { label: string; waarde: string }[];
  twijfel?: string;
}

/** Splits de mechanische waarschuwingen in item-specifieke (prefix "[id]") en algemene. */
function splitsWaarschuwingen(ws: string[]): { perId: Record<string, string[]>; algemeen: string[] } {
  const perId: Record<string, string[]> = {};
  const algemeen: string[] = [];
  const re = /^\[([^\]]+)\]\s*/;
  for (const w of ws) {
    const m = re.exec(w);
    if (m) (perId[m[1]] ??= []).push(w.slice(m[0].length));
    else algemeen.push(w);
  }
  return { perId, algemeen };
}

function itemsUitAnalyse(act: "2" | "3", data: Analyse2 | Analyse3): ReviewItem[] {
  if (act === "2") {
    const a = data as Analyse2;
    return (a.markeringen ?? []).map((m) => ({
      id: m.id,
      titel: m.formulering || m.id,
      klasse: m.klasse,
      regels: [
        { label: "Vindplaats", waarde: m.vindplaats },
        { label: "Toelichting", waarde: m.toelichting },
      ],
      twijfel: m.twijfel,
    }));
  }
  const a = data as Analyse3;
  const begrippen: ReviewItem[] = (a.begrippen ?? []).map((b) => ({
    id: b.id,
    titel: b.naam || b.id,
    klasse: b.klasse,
    regels: [
      { label: "Definitie", waarde: b.definitie },
      { label: "Kenmerken", waarde: b.kenmerken },
      { label: "Vindplaats", waarde: b.vindplaats },
    ],
    twijfel: b.twijfel,
  }));
  const regels: ReviewItem[] = (a.afleidingsregels ?? []).map((r) => ({
    id: r.id,
    titel: r.naam || r.id,
    klasse: r.type,
    regels: [
      { label: "Uitvoer", waarde: r.uitvoervariabele },
      { label: "Invoer", waarde: r.invoervariabelen },
      { label: "Voorwaarden", waarde: r.voorwaarden },
      { label: "Formulering", waarde: r.formulering },
    ],
    twijfel: r.twijfel,
  }));
  return [...begrippen, ...regels];
}

export function ReviewPanel({
  job,
  activiteit,
  onSubmitted,
  onDelete,
  verwijderBezig,
}: {
  job: Job;
  activiteit: "2" | "3";
  onSubmitted: () => void | Promise<void>;
  /** Gooi de hele analyse weg (incl. bevestiging) — afgehandeld door de ouder. */
  onDelete?: () => void | Promise<void>;
  verwijderBezig?: boolean;
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [opmerkingen, setOpmerkingen] = useState<Record<string, string>>({});
  const [algemeen, setAlgemeen] = useState("");
  const [bezig, setBezig] = useState<null | "akkoord" | "wijzigingen">(null);
  const [fout, setFout] = useState<string | null>(null);

  const ronde = job.current_ronde || 1;
  const { perId: waarschuwingenPerId, algemeen: algemeneWaarschuwingen } = splitsWaarschuwingen(
    job.waarschuwingen,
  );

  useEffect(() => {
    let actief = true;
    getRonde(job.id, activiteit, ronde)
      .then((d) => actief && setItems(itemsUitAnalyse(activiteit, d)))
      .catch((e) => actief && setLaadFout(isApiError(e) ? e.detail : (e as Error).message));
    return () => {
      actief = false;
    };
  }, [job.id, activiteit, ronde]);

  async function verstuur(status: "akkoord" | "wijzigingen") {
    setFout(null);
    const ingevuld: Record<string, string> = {};
    for (const [k, v] of Object.entries(opmerkingen)) if (v.trim()) ingevuld[k] = v.trim();

    if (status === "wijzigingen" && Object.keys(ingevuld).length === 0 && !algemeen.trim()) {
      setFout("Geef minstens één opmerking of een algemene opmerking om wijzigingen in te dienen.");
      return;
    }

    const body: Feedback = {
      status,
      activiteit,
      items: status === "wijzigingen" ? ingevuld : {},
      algemeen: status === "wijzigingen" ? algemeen.trim() : "",
    };
    setBezig(status);
    try {
      await sendFeedback(job.id, body);
      await onSubmitted();
    } catch (e) {
      if (isApiError(e) && e.status === 409) setFout("De status is intussen veranderd; de pagina ververst.");
      else setFout(isApiError(e) ? e.detail : (e as Error).message);
      await onSubmitted();
    }
    setBezig(null);
  }

  const titel =
    activiteit === "2"
      ? "Review activiteit 2 — markeringen & classificaties"
      : "Review activiteit 3 — begrippen & afleidingsregels";

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">{titel}</h2>
        <span className="font-mono text-xs text-faint">ronde {ronde}</span>
      </div>
      <p className="mb-5 max-w-prose text-sm text-muted">
        Beoordeel elk item. Laat een veld leeg als je akkoord bent. Bij twijfel van de analyse staat
        een geel kader. Kies daarna <em>Akkoord</em> (door naar de volgende fase) of{" "}
        <em>Wijzigingen indienen</em> (nieuwe ronde met jouw opmerkingen).
      </p>

      {laadFout && (
        <div className="mb-4 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
          Kon de ronde niet laden: {laadFout}
        </div>
      )}

      {algemeneWaarschuwingen.length > 0 && (
        <div role="status" className="mb-4 rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-sm text-gold">
          <p className="font-medium">
            <span aria-hidden="true">⚠ </span>Aandachtspunten bij deze ronde
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {algemeneWaarschuwingen.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {!items && !laadFout && <p className="text-sm text-muted">Laden…</p>}

      <div className="space-y-3">
        {items?.map((it) => (
          <div key={it.id} className="rounded-lg border border-line bg-paper/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-ink">{it.titel}</p>
                <span className="font-mono text-xs text-faint">{it.id}</span>
              </div>
              {it.klasse && <JasBadge klasse={it.klasse} />}
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              {it.regels
                .filter((r) => r.waarde)
                .map((r) => (
                  <div key={r.label} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-xs uppercase tracking-wide text-faint">{r.label}</dt>
                    <dd className="min-w-0 break-words text-muted">{r.waarde}</dd>
                  </div>
                ))}
            </dl>
            {it.twijfel && (
              <p className="mt-2 rounded border border-gold/40 bg-gold/5 px-2 py-1 text-xs text-gold">
                <span aria-hidden="true">⚠ </span>Twijfel: {it.twijfel}
              </p>
            )}
            {waarschuwingenPerId[it.id]?.map((w, i) => (
              <p
                key={i}
                role="status"
                className="mt-2 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-accent"
              >
                <span aria-hidden="true">⚠ </span>Let op: {w}
              </p>
            ))}
            <Textarea
              value={opmerkingen[it.id] ?? ""}
              onChange={(e) => setOpmerkingen((o) => ({ ...o, [it.id]: e.target.value }))}
              rows={2}
              placeholder="Opmerking (leeg = akkoord)…"
              className="mt-3 bg-surface"
            />
          </div>
        ))}
      </div>

      <div className="mt-5">
        <label className="mb-1 block text-sm font-medium text-ink">Algemene opmerking</label>
        <Textarea
          value={algemeen}
          onChange={(e) => setAlgemeen(e.target.value)}
          rows={2}
          placeholder="Overkoepelende opmerkingen voor deze activiteit…"
        />
      </div>

      {fout && (
        <div className="mt-4 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
          {fout}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        {onDelete ? (
          <Button
            variant="danger"
            onClick={() => onDelete()}
            disabled={bezig !== null || verwijderBezig}
            title="Verwijder deze analyse definitief"
          >
            {verwijderBezig ? "Verwijderen…" : "Analyse verwijderen"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => verstuur("wijzigingen")}
            disabled={bezig !== null || verwijderBezig || !items}
          >
            {bezig === "wijzigingen" ? "Versturen…" : "Wijzigen"}
          </Button>
          <Button
            onClick={() => verstuur("akkoord")}
            disabled={bezig !== null || verwijderBezig || !items}
          >
            {bezig === "akkoord" ? "Versturen…" : "Akkoord"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
