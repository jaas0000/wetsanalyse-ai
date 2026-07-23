"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, Source, SSEData, AnnotatieElement, OntbrekendItem, AnnotatieDoel } from "./chat-types";

interface StreamState {
  isStreaming: boolean;
  reasoningText: string;
  answerText: string;
  sources: Source[];
  groundingOk: boolean | null;
  error: string | null;
}

const INIT: StreamState = {
  isStreaming: false,
  reasoningText: "",
  answerText: "",
  sources: [],
  groundingOk: null,
  error: null,
};

export type AnnotatieEvent =
  | { type: "doel"; doel: AnnotatieDoel }
  | { type: "element"; element: AnnotatieElement }
  | { type: "ontbrekend"; items: OntbrekendItem[] };

export function useChatStream(conversationId: string | null) {
  const [state, setState] = useState<StreamState>(INIT);
  const abortRef = useRef<AbortController | null>(null);
  // Throttle: setState maximaal 1x per 120ms tijdens streaming.
  // 120ms geeft ~8 renders/sec — vloeiend zichtbaar en goedkoop genoeg om
  // de main thread vrij te houden voor user-interactie. Eerder 50ms (20×/sec)
  // gaf te weinig ruimte bij zware renders (formatMarkdown e.d.).
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef<Partial<StreamState>>({});

  function scheduleFlush() {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const patch = pendingState.current;
      pendingState.current = {};
      if (Object.keys(patch).length > 0) {
        setState(s => ({ ...s, ...patch }));
      }
    }, 120);
  }

  function patchState(patch: Partial<StreamState>) {
    Object.assign(pendingState.current, patch);
    scheduleFlush();
  }

  // Reset stream-state bij gesprekswisseling, maar NIET als er al een stream
  // actief is. Dat geval treedt op wanneer createConversation() en stream()
  // in dezelfde event-handler worden aangeroepen: React batcht de state-updates
  // tot één render, waarna de useEffect de conversationId-wijziging (null → newId)
  // detecteert en anders ten onrechte alles naar INIT reset terwijl de stream loopt.
  const prevConvId = useRef(conversationId);
  useEffect(() => {
    if (prevConvId.current !== conversationId) {
      prevConvId.current = conversationId;
      setState(s => s.isStreaming ? s : INIT);
    }
  }, [conversationId]);

  const reset = useCallback(() => setState(INIT), []);

  const stream = useCallback(
    async (
      question: string,
      onChunk: (partial: Partial<Message>) => void,
      onDone: (final: Partial<Message>) => void,
      onAnnotatie?: (event: AnnotatieEvent) => void,
    ) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setState({ ...INIT, isStreaming: true });
      pendingState.current = {};

      let reasoning = "";
      let answer = "";
      let sources: Source[] = [];
      let groundingOk: boolean | null = null;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            thread_id: conversationId ?? undefined,
          }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // Vlag zodat een `done`-event óók de buitenste leeslus verlaat. Zonder dit
        // brak `break` alleen de frame-lus en blokkeerde reader.read() tot de
        // upstream-timeout (300s) als de socket na `done` open blijft → schijnbaar vast.
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const frames = buf.split(/\r?\n\r?\n/);
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            const lines = frame.trim().split(/\r?\n/);
            let eventType = "token";
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              if (line.startsWith("data:")) dataLine = line.slice(5).trim();
            }
            if (!dataLine) continue;

            let parsed: SSEData;
            try { parsed = JSON.parse(dataLine); }
            catch { continue; }

            const msgType = (parsed as Record<string, unknown>)["type"] as string | undefined;

            if (msgType === "reason" || msgType === "reasoning_delta") {
              const chunk = ((parsed as Record<string, unknown>)["content"] ?? (parsed as Record<string, unknown>)["delta"] ?? "") as string;
              reasoning += chunk;
              patchState({ reasoningText: reasoning });
              onChunk({ reasoning });

            } else if (msgType === "token") {
              const chunk = ((parsed as Record<string, unknown>)["content"] ?? (parsed as Record<string, unknown>)["token"] ?? "") as string;
              answer += chunk;
              patchState({ answerText: answer });
              onChunk({ content: answer });

            } else if (msgType === "sources" && "sources" in parsed) {
              sources = parsed.sources;
              const gok = (parsed as Record<string, unknown>)["grounding_ok"];
              groundingOk = gok != null ? (gok as boolean) : null;
              patchState({ sources, groundingOk });

            } else if (msgType === "grounding") {
              const grounded = (parsed as Record<string, unknown>)["grounded"];
              groundingOk = grounded != null ? (grounded as boolean) : null;
              patchState({ groundingOk });

            } else if (msgType === "doel") {
              onAnnotatie?.({ type: "doel", doel: (parsed as Record<string, unknown>)["doel"] as AnnotatieDoel });

            } else if (msgType === "element") {
              onAnnotatie?.({ type: "element", element: (parsed as Record<string, unknown>)["element"] as AnnotatieElement });

            } else if (msgType === "ontbrekend") {
              onAnnotatie?.({ type: "ontbrekend", items: (parsed as Record<string, unknown>)["items"] as OntbrekendItem[] ?? [] });

            } else if (msgType === "done" || eventType === "done") {
              streamDone = true;
              break;
            } else if (msgType === "error") {
              const detail = (parsed as Record<string, unknown>)["detail"] as string | undefined;
              if (detail) throw new Error(detail);
            }
          }
        }

        // Bij `done` de reader losmaken van de (mogelijk nog open) upstream-socket
        // zodat er geen verbinding blijft hangen.
        if (streamDone) await reader.cancel().catch(() => {});

        // Flush eventuele nog-openstaande pending state en zet isStreaming=false
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
        setState(s => ({ ...s, ...pendingState.current, isStreaming: false }));
        pendingState.current = {};
        onDone({ content: answer, reasoning, sources, groundingOk });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = (err as Error).message;
        if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
        setState(s => ({ ...s, ...pendingState.current, isStreaming: false, error: msg }));
        pendingState.current = {};
        onDone({ content: answer || "", reasoning, sources, groundingOk: false });
      }
    },
    [conversationId]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    pendingState.current = {};
    setState(s => ({ ...s, isStreaming: false }));
  }, []);

  return { ...state, stream, abort, reset };
}
