"use client";

import type { Message } from "@/lib/chat-types";
import { ReasonBlock, SourcesCard } from "./SourcesCard";
import { useEffect, useRef, useState } from "react";

interface Props {
  messages: Message[];
  streamingContent?: string;
  streamingReasoning?: string;
  isStreaming?: boolean;
  showStreaming?: boolean;
  showReasoning?: boolean;
  welcomeNode?: React.ReactNode;
  compact?: boolean;
  /** Optionele ref op de scrollbare container, voor externe scroll-detectie */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      className={`chat-copy-btn${copied ? " copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Gekopieerd!" : "Kopieer antwoord"}
      aria-label="Kopieer antwoord"
    >
      {copied ? (
        /* Vinkje */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        /* Clipboard */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="2" width="6" height="3" rx="1" stroke="currentColor" strokeWidth="1.8"/>
          <path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      )}
    </button>
  );
}

export default function ChatMessages({
  messages,
  streamingContent,
  streamingReasoning,
  isStreaming,
  showStreaming = true,
  showReasoning = true,
  welcomeNode,
  compact = false,
  scrollContainerRef,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLDivElement>(null);
  // Gebruik de externe ref als die gegeven is, anders de interne
  const containerRef = (scrollContainerRef as React.RefObject<HTMLDivElement>) ?? internalRef;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return <div ref={containerRef} className={`chat-messages-wrap${compact ? " compact" : ""}`}>{welcomeNode}</div>;
  }

  return (
    <div ref={containerRef} className={`chat-messages-wrap${compact ? " compact" : ""}`}>
      <div className="chat-messages-inner">
        {messages.map(msg => {
          // Placeholder wordt getoond via het live streaming-blok — overslaan
          if (msg.isStreaming) return null;
          return (
          <div key={msg.id}>
            {msg.role === "user" ? (
              <div className="chat-msg-user">
                <div className="chat-msg-user-bubble">{msg.content}</div>
              </div>
            ) : (
              <div className="chat-msg-agent">
                <div className="chat-msg-agent-name">Juridische Assistent</div>
                {showReasoning && msg.reasoning && <ReasonBlock text={msg.reasoning} />}
                <div
                  className="chat-msg-agent-content"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                />
                <div className="chat-msg-actions">
                  <CopyButton text={msg.content} />
                </div>
                {msg.sources && msg.sources.length > 0 && (
                  <SourcesCard sources={msg.sources} groundingOk={msg.groundingOk ?? null} />
                )}
              </div>
            )}
          </div>
          );
        })}

        {/* Live streaming message */}
        {isStreaming && showStreaming && (
          <div className="chat-msg-agent">
            <div className="chat-msg-agent-name">Juridische Assistent</div>
            {showReasoning && streamingReasoning && <ReasonBlock text={streamingReasoning} defaultOpen={true} />}
            <div className="chat-msg-agent-content">
              <span dangerouslySetInnerHTML={{ __html: formatMarkdown(streamingContent ?? "") }} />
              <span className="chat-cursor" />
            </div>
          </div>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

// Volledige markdown-formatter (geen externe dep)
// Ondersteunt: koppen (h1-h3), codeblokken (```), blockquotes (>),
// ongeordende lijsten (- / * / +), geordende lijsten (1.), horizontale lijn,
// bold (**), italic (*), inline-code (`), links ([label](url))
function formatMarkdown(text: string): string {
  if (!text) return "";

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inlineFormat(s: string): string {
    return escHtml(s)
      // Links vóór bold/italic (anders verslinden sterretjes de markdown)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
        `<a href="${escHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(escHtml(lines[i]));
        i++;
      }
      out.push(`<pre class="md-pre"${lang ? ` data-lang="${lang}"` : ""}><code>${codeLines.join("\n")}</code></pre>`);
      i++; // sluit ```
      continue;
    }

    // ── Heading ────────────────────────────────────────────────────
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level} class="md-h${level}">${inlineFormat(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // ── Horizontale lijn ───────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      out.push("<hr class=\"md-hr\" />");
      i++;
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(inlineFormat(lines[i].replace(/^>\s?/, "")));
        i++;
      }
      out.push(`<blockquote class="md-blockquote">${quoteLines.join("<br/>")}</blockquote>`);
      continue;
    }

    // ── Ongeordende lijst ──────────────────────────────────────────
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^[-*+]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul class="md-ul">${items.join("")}</ul>`);
      continue;
    }

    // ── Geordende lijst ────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol class="md-ol">${items.join("")}</ol>`);
      continue;
    }

    // ── Lege regel → alinea-scheiding ─────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Alinea — verzamel opeenvolgende tekstregels ────────────────
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}|[-*+]|\d+\.|>|```)/.test(lines[i])
    ) {
      paraLines.push(inlineFormat(lines[i]));
      i++;
    }
    if (paraLines.length) {
      out.push(`<p class="md-p">${paraLines.join("<br/>")}</p>`);
    }
  }

  return out.join("\n");
}
