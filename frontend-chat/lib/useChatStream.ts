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

  // Reset stream-state bij gesprekswisseling
  const prevConvId = useRef(conversationId);
  useEffect(() => {
    if (prevConvId.current !== conversationId) {
      prevConvId.current = conversationId;
      setState(INIT);
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

        while (true) {
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
              setState(s => ({ ...s, reasoningText: reasoning }));
              onChunk({ reasoning });

            } else if (msgType === "token") {
              const chunk = ((parsed as Record<string, unknown>)["content"] ?? (parsed as Record<string, unknown>)["token"] ?? "") as string;
              answer += chunk;
              setState(s => ({ ...s, answerText: answer }));
              onChunk({ content: answer });

            } else if (msgType === "sources" && "sources" in parsed) {
              sources = parsed.sources;
              const gok = (parsed as Record<string, unknown>)["grounding_ok"];
              groundingOk = gok != null ? (gok as boolean) : null;
              setState(s => ({ ...s, sources, groundingOk }));

            } else if (msgType === "grounding") {
              const grounded = (parsed as Record<string, unknown>)["grounded"];
              groundingOk = grounded != null ? (grounded as boolean) : null;
              setState(s => ({ ...s, groundingOk }));

            } else if (msgType === "doel") {
              onAnnotatie?.({ type: "doel", doel: (parsed as Record<string, unknown>)["doel"] as AnnotatieDoel });

            } else if (msgType === "element") {
              onAnnotatie?.({ type: "element", element: (parsed as Record<string, unknown>)["element"] as AnnotatieElement });

            } else if (msgType === "ontbrekend") {
              onAnnotatie?.({ type: "ontbrekend", items: (parsed as Record<string, unknown>)["items"] as OntbrekendItem[] ?? [] });

            } else if (msgType === "done" || eventType === "done") {
              break;
            } else if (msgType === "error") {
              const detail = (parsed as Record<string, unknown>)["detail"] as string | undefined;
              if (detail) throw new Error(detail);
            }
          }
        }

        setState(s => ({ ...s, isStreaming: false }));
        onDone({ content: answer, reasoning, sources, groundingOk });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = (err as Error).message;
        setState(s => ({ ...s, isStreaming: false, error: msg }));
        onDone({ content: answer || "", reasoning, sources, groundingOk: false });
      }
    },
    [conversationId]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState(s => ({ ...s, isStreaming: false }));
  }, []);

  return { ...state, stream, abort, reset };
}
