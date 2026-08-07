"use client";

import { useEffect, useState } from "react";
import { Card, Section } from "@/components/ui/Card";
import { Melding } from "@/components/ui/Melding";
import { getFeedback, isApiError, markeerFeedbackGezien, verwijderFeedback } from "@/lib/api";
import type { FeedbackItem } from "@/lib/api";

const CATEGORIE_LABELS: Record<string, string> = {
  verbeteridee: "Verbeteridee",
  probleemmelding: "Probleemmelding",
  compliment: "Compliment",
  vraag: "Vraag",
};

export function FeedbackLijstClient() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState<number | null>(null);

  useEffect(() => {
    void markeerFeedbackGezien().catch(() => { /* stil falen */ });
    getFeedback()
      .then(setItems)
      .catch((e) => setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message));
  }, []);

  async function onVerwijder(id: number) {
    if (!confirm("Dit feedbackbericht verwijderen?")) return;
    setBezig(id);
    try {
      await verwijderFeedback(id);
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? null);
    } catch (e) {
      setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
    } finally {
      setBezig(null);
    }
  }

  return (
    <Section title="Ingezonden feedback" count={items?.length}>
      {fout && <Melding type="fout" className="mb-3">{fout}</Melding>}
      {items === null ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nog geen feedback ingezonden.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-faint">#{item.id}</span>
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  {CATEGORIE_LABELS[item.categorie] ?? item.categorie}
                </span>
                <span className="text-xs text-muted">{item.userid}</span>
                <span className="ml-auto text-xs text-faint">
                  {new Date(item.created).toLocaleString("nl-NL", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => void onVerwijder(item.id)}
                  disabled={bezig === item.id}
                  aria-label={`Feedbackbericht #${item.id} verwijderen`}
                  className="text-xs text-fout opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed"
                >
                  {bezig === item.id ? "…" : "Verwijderen"}
                </button>
              </div>
              {item.pagina && (
                <p className="mt-2 text-xs text-muted">
                  <span className="font-medium text-ink">Pagina:</span>{" "}
                  <span className="font-mono">{item.pagina}</span>
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{item.tekst}</p>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
