"use client";

import { useEffect, useState } from "react";
import type { DashboardUpdate, JobSummary } from "./types";

/** Beginstand uit de SSR-lijst; de aggregate-SSE verrijkt/overschrijft dit binnen enkele seconden. */
export function summaryNaarUpdate(s: JobSummary): DashboardUpdate {
  return {
    id: s.id,
    naam: s.naam,
    bronnen: s.bronnen ?? [],
    state: s.state,
    current_activiteit: null,
    current_ronde: 0,
    current_fase: s.current_fase ?? null,
    current_fase_sinds: null,
    created: s.updated,
    updated: s.updated,
    model_profile: s.model_profile ?? "",
    tokens_in: s.tokens_in ?? 0,
    tokens_out: s.tokens_out ?? 0,
    error: null,
  };
}

/** Eén aggregate-SSE-stream over álle projecten van de client. Seedt uit de SSR-lijst en houdt de
 *  momentopnamen live bij via `data:`- (gewijzigd/nieuw project) en `removed`-events. Gedeeld door de
 *  home-lijst en het dashboard, zodat beide live lopen zonder een tweede mechanisme. De browser
 *  herverbindt zelf na de ~10-min servercap; vandaar één stabiele EventSource per mount. */
export function useProjectenStream(initieel: JobSummary[]) {
  const [items, setItems] = useState<Map<string, DashboardUpdate>>(
    () => new Map(initieel.map((s) => [s.id, summaryNaarUpdate(s)])),
  );
  const [verbonden, setVerbonden] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/projects/events");
    es.onopen = () => setVerbonden(true);
    es.onmessage = (e) => {
      try {
        const u = JSON.parse(e.data) as DashboardUpdate;
        setItems((prev) => new Map(prev).set(u.id, u));
      } catch {
        /* niet-JSON keepalive/regel — negeren */
      }
    };
    es.addEventListener("removed", (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
        setItems((prev) => {
          const m = new Map(prev);
          m.delete(id);
          return m;
        });
      } catch {
        /* negeren */
      }
    });
    es.onerror = () => setVerbonden(false); // browser herverbindt automatisch
    return () => es.close();
  }, []);

  return { items, verbonden };
}
