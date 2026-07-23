"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { AnnotatieElement, AnnotatieDoel, OntbrekendItem } from "./chat-types";
import type { AnnotatieEvent } from "./useChatStream";

type Feedback = Record<number, { feedback: "akkoord" | "afwijzen" | "twijfel"; notitie: string }>;

interface AnnotatieEntry {
  doel: AnnotatieDoel;
  elementen: AnnotatieElement[];
  ontbrekend: OntbrekendItem[];
  feedback: Feedback;
}

/**
 * Beheert de annotatie-cache per gesprek-id.
 *
 * - Mutaties gaan via `handleEvent` (streaming) en `handleFeedback` (gebruikersactie).
 * - De cache zelf is een ref (geen re-render bij elke mutatie), maar de actieve
 *   annotatie-data wordt als eigen state bijgehouden zodat alleen de annotatie-
 *   consumer (AnnotatieWorkbench) opnieuw rendert — niet de hele ChatClient.
 */
export function useAnnotatie(activeId: string | null) {
  // Cache: ref zodat mutaties geen re-render van de parent triggeren
  const cacheRef = useRef<Record<string, AnnotatieEntry>>({});

  // Alleen de data voor het actieve gesprek als state; update via setActief
  const [actief, setActief] = useState<AnnotatieEntry | null>(null);

  // Sync: bij gesprekswisseling de juiste cache-entry laden
  const syncActief = useCallback((id: string | null) => {
    setActief(id ? (cacheRef.current[id] ?? null) : null);
  }, []);

  // Verwerk een annotatie-event (doel / element / ontbrekend)
  const handleEvent = useCallback((convId: string, event: AnnotatieEvent) => {
    const existing = cacheRef.current[convId] ?? {
      doel: null as unknown as AnnotatieDoel,
      elementen: [],
      ontbrekend: [],
      feedback: {},
    };

    let updated: AnnotatieEntry;
    if (event.type === "doel") {
      updated = { ...existing, doel: event.doel };
    } else if (event.type === "element") {
      updated = { ...existing, elementen: [...existing.elementen, event.element] };
    } else {
      // "ontbrekend"
      updated = { ...existing, ontbrekend: event.items };
    }

    cacheRef.current[convId] = updated;
    // Alleen de actieve entry triggert een state-update
    if (convId === activeId) setActief(updated);
  }, [activeId]);

  // Verwerk gebruikersfeedback op een element
  const handleFeedback = useCallback((
    convId: string,
    idx: number,
    feedback: "akkoord" | "afwijzen" | "twijfel",
    notitie: string,
  ) => {
    const existing = cacheRef.current[convId];
    if (!existing) return;
    const updated: AnnotatieEntry = {
      ...existing,
      feedback: { ...existing.feedback, [idx]: { feedback, notitie } },
    };
    cacheRef.current[convId] = updated;
    if (convId === activeId) setActief(updated);
  }, [activeId]);

  // Elementen met feedback samengevoegd — gememoïseerd zodat AnnotatieWorkbench
  // geen nieuwe array-referentie krijgt tenzij data echt wijzigt
  const elementenMetFeedback = useMemo<AnnotatieElement[]>(() => {
    if (!actief) return [];
    return actief.elementen.map((el, i) => ({
      ...el,
      ...(actief.feedback[i] ?? {}),
    }));
  }, [actief]);

  return {
    actief,
    syncActief,
    handleEvent,
    handleFeedback,
    elementenMetFeedback,
  };
}
