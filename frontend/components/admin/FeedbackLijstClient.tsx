"use client";

import { useEffect, useState } from "react";
import { Card, Section } from "@/components/ui/Card";
import { Melding } from "@/components/ui/Melding";
import { getFeedback, isApiError } from "@/lib/api";
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

  useEffect(() => {
    getFeedback()
      .then(setItems)
      .catch((e) => setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message));
  }, []);

  return (
    <Section title="Berichten" count={items?.length}>
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
                <span className="text-sm font-medium text-ink">
                  {CATEGORIE_LABELS[item.categorie] ?? item.categorie}
                </span>
                <span className="text-xs text-muted">{item.userid}</span>
                {item.pagina && (
                  <span className="font-mono text-xs text-faint">{item.pagina}</span>
                )}
                <span className="ml-auto text-xs text-faint">
                  {new Date(item.created).toLocaleString("nl-NL", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{item.tekst}</p>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
