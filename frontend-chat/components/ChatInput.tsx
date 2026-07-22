"use client";

import { useCallback, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAbort?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  streamError?: string | null;
}

export default function ChatInput({ value, onChange, onSubmit, onAbort, disabled, isStreaming, streamError }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [value]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && !isStreaming && value.trim()) onSubmit();
      }
    },
    [disabled, isStreaming, value, onSubmit]
  );

  const canSend = !disabled && !isStreaming && value.trim().length > 0;

  return (
    <div className="chat-input-area">
      {streamError && (
        <div className="chat-stream-error" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          {streamError}
        </div>
      )}
      <div className="chat-input-inner">
        <div className="chat-input-box">
          <div className="chat-input-row">
            <textarea
              ref={ref}
              className="chat-textarea"
              placeholder="Stel een juridische vraag…"
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={disabled || isStreaming}
            />
            <button
              className="chat-send-btn"
              onClick={isStreaming ? onAbort : onSubmit}
              disabled={isStreaming ? !onAbort : !canSend}
              title={isStreaming ? "Stoppen" : "Versturen"}
              aria-label={isStreaming ? "Genereren stoppen" : "Bericht versturen"}
            >
              {isStreaming ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="white" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          <div className="chat-input-footer">
            <span className="chat-input-footer-dot" />
            <span>Kennisgraaf actief &nbsp;·&nbsp; Enter = versturen &nbsp;·&nbsp; Shift+Enter = nieuwe regel</span>
          </div>
        </div>
      </div>
    </div>
  );
}
