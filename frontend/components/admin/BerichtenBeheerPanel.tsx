"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonRow } from "@/components/ui/ButtonRow";
import { Card, Section } from "@/components/ui/Card";
import { BerichtBadge } from "@/components/ui/BerichtBadge";
import { Tag } from "@/components/ui/Badge";
import { Melding } from "@/components/ui/Melding";
import { Skeleton } from "@/components/ui/Skeleton";
import { BerichtEditor } from "./BerichtEditor";
import {
  isApiError,
  listAlleBerichten,
  verwijderBericht,
  zetPublicatie,
} from "@/lib/api";
import type { AdminBerichtOut, BerichtType } from "@/lib/types";

export function BerichtenBeheerPanel() {
  const [berichten, setBerichten] = useState<AdminBerichtOut[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // false = lijstweergave; null = nieuw bericht; AdminBerichtOut = bewerken
  const [editBericht, setEditBericht] = useState<AdminBerichtOut | null | false>(false);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      setBerichten(await listAlleBerichten());
    } catch (e) {
      setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
      setBerichten([]);
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  async function onPublicatie(b: AdminBerichtOut) {
    try {
      await zetPublicatie(b.id, !b.gepubliceerd);
      await laad();
    } catch (e) {
      setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
    }
  }

  async function onVerwijder(b: AdminBerichtOut) {
    if (!confirm(`Bericht "${b.titel}" definitief verwijderen?`)) return;
    try {
      await verwijderBericht(b.id);
      await laad();
    } catch (e) {
      setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
    }
  }

  if (editBericht !== false) {
    return (
      <Section title={editBericht ? "Bericht bewerken" : "Nieuw bericht"}>
        <BerichtEditor
          bericht={editBericht}
          onCancel={() => setEditBericht(false)}
          onDone={() => { setEditBericht(false); void laad(); }}
        />
      </Section>
    );
  }

  return (
    <Section title="Berichten" subtitle="Release notes en aankondigingen voor analisten.">
      {fout && <Melding type="fout" compact className="mb-4">{fout}</Melding>}

      <div className="mb-4">
        <Button onClick={() => setEditBericht(null)}>Nieuw bericht</Button>
      </div>

      {berichten === null && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {berichten !== null && berichten.length === 0 && (
        <p className="text-sm text-muted">Nog geen berichten.</p>
      )}

      {berichten !== null && berichten.length > 0 && (
        <div className="space-y-3">
          {berichten.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <BerichtBadge type={b.type as BerichtType} />
                  {b.versie && <Tag>{b.versie}</Tag>}
                  <span
                    className={`text-xs font-medium ${
                      b.gepubliceerd ? "text-succes" : "text-muted"
                    }`}
                  >
                    {b.gepubliceerd ? "Gepubliceerd" : "Concept"}
                  </span>
                </div>
                <p className="text-xs text-faint">
                  {new Date(b.created).toLocaleDateString("nl-NL")}
                </p>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-ink">{b.titel}</p>
              <ButtonRow className="mt-3">
                <Button size="sm" variant="secondary" onClick={() => setEditBericht(b)}>
                  Bewerken
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void onPublicatie(b)}>
                  {b.gepubliceerd ? "Depubliceren" : "Publiceren"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void onVerwijder(b)}>
                  Verwijderen
                </Button>
              </ButtonRow>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
