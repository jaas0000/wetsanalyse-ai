"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import ChatSidebar from "@/components/ChatSidebar";
import ChatTopbar from "@/components/ChatTopbar";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import ArtifactPanel from "@/components/ArtifactPanel";
import SettingsPanel from "@/components/SettingsPanel";
import AccountPanel from "@/components/AccountPanel";
import AnnotatieWorkbench from "@/components/AnnotatieWorkbench";
import { useChatConversations } from "@/lib/useChatConversations";
import { useChatStream } from "@/lib/useChatStream";
import { useAnnotatie } from "@/lib/useAnnotatie";
import type { PanelView, Source } from "@/lib/chat-types";

interface Props {
  userid: string;
  email: string;
  role: string;
  initials: string;
}

const SUGGESTIONS = [
  "Wanneer verjaart een belastingaanslag?",
  "Wat is het gevolg van niet tijdig betalen?",
  "Hoe werkt uitstel van betaling bij bezwaar?",
  "Wat zijn de bevoegdheden van de ontvanger?",
];

export default function ChatClient({ userid, email, role, initials }: Props) {
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<PanelView>("chat");
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [lastSources, setLastSources] = useState<Source[]>([]);
  const [lastGrounding, setLastGrounding] = useState<boolean | null>(null);
  const [graphOnline, setGraphOnline] = useState<boolean | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesWrapRef = useRef<HTMLDivElement>(null);

  const convs = useChatConversations();
  const chatStream = useChatStream(convs.activeId);

  // Annotatie-state per gesprek — geïsoleerd in een eigen hook zodat annotatie-
  // updates alleen de workbench laten herrenderen, niet de hele ChatClient.
  const annot = useAnnotatie(convs.activeId);

  // Sync annotatie-cache naar het nieuwe gesprek bij gesprekswisseling
  const handleSelect = (id: string) => {
    convs.setActiveId(id);
    annot.syncActief(id);
    setPanel("chat");
    setSidebarOpen(false);
  };

  const handleNew = () => {
    convs.setActiveId(null);
    annot.syncActief(null);
    setPanel("chat");
  };

  // C3 — periodieke health-check kennisgraaf (elke 30s)
  useEffect(() => {
    async function checkHealth() {
      try {
        // Eigen client-time-out: hangt de fetch (bufferende proxy e.d.), dan valt
        // de status terug op "offline" i.p.v. eeuwig op "Verbinding controleren…".
        const res = await fetch("/api/health", { signal: AbortSignal.timeout(6000) });
        setGraphOnline(res.ok);
      } catch {
        setGraphOnline(false);
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Focus-management: bij panelwisseling naar settings/account eerste focusbaar element activeren
  const panelAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panel === "chat") return;
    requestAnimationFrame(() => {
      const el = panelAreaRef.current?.querySelector<HTMLElement>(
        "button, input, textarea, a[href], select, [tabindex]:not([tabindex='-1'])"
      );
      el?.focus();
    });
  }, [panel]);

  // Scroll-to-bottom knop: toon als gebruiker meer dan 200px boven de onderkant zit
  useEffect(() => {
    const el = messagesWrapRef.current;
    if (!el) return;
    function handleScroll() {
      if (!el) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 200);
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [panel]);

  function scrollToBottom() {
    const el = messagesWrapRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  // Instellingen — eenmalig ingelezen + bijgehouden via storage-event
  const [settings, setSettings] = useState<Record<string, unknown>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("chat_settings") ?? "{}"); }
    catch { return {}; }
  });
  // Ref zodat callbacks altijd de meest actuele settings lezen (geen stale closure)
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== "chat_settings") return;
      try { setSettings(JSON.parse(e.newValue ?? "{}")); }
      catch { setSettings({}); }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Propageer stream-fouten naar de UI
  useEffect(() => {
    if (chatStream.error) setStreamError(chatStream.error);
  }, [chatStream.error]);

  const handleSubmit = useCallback(async (override?: string) => {
    const q = (override ?? input).trim();
    if (!q || chatStream.isStreaming) return;

    let convId = convs.activeId;
    if (!convId) {
      const c = convs.createConversation(q);
      convId = c.id;
    }

    setPanel("chat");
    setArtifactOpen(false);
    setInput("");
    setStreamError(null);

    convs.addMessage(convId, { role: "user", content: q });
    convs.addMessage(convId, { role: "assistant", content: "", isStreaming: true });

    await chatStream.stream(
      q,
      // onChunk: streaming content wordt live getoond via chatStream.answerText —
      // updateLastMessage hier weglaten voorkomt localStorage-schrijven per token
      // en daarmee het vastlopen van de browser bij snelle streams.
      (_partial) => { /* geen localStorage-write per token */ },
      (final) => {
        convs.updateLastMessage(convId!, {
          content: final.content ?? "",
          reasoning: final.reasoning,
          sources: final.sources ?? [],
          groundingOk: final.groundingOk ?? true,
          isStreaming: false,
        });
        if (final.sources && final.sources.length > 0) {
          setLastSources(final.sources);
          setLastGrounding(final.groundingOk ?? null);
          if (settingsRef.current.autoSources !== false) setArtifactOpen(true);
        }
      },
      // onAnnotatie — delegeer naar de useAnnotatie-hook zodat alleen
      // AnnotatieWorkbench opnieuw rendert, niet de hele ChatClient.
      (event) => annot.handleEvent(convId!, event),
    );
  }, [input, chatStream, convs, annot]);

  const grouped = useMemo(() => convs.grouped(), [convs.grouped, convs.conversations]);
  const active = convs.active;
  const displayTitle = panel === "settings" ? "Instellingen"
    : panel === "account" ? "Account"
    : active?.title ?? "";

  const userName = userid;

  const handleFeedback = (idx: number, feedback: "akkoord" | "afwijzen" | "twijfel", notitie: string) => {
    const id = convs.activeId;
    if (!id) return;
    annot.handleFeedback(id, idx, feedback, notitie);
  };

  // Reset feedback bij nieuw gesprek — al afgehandeld door handleNew / handleSelect via annot.syncActief

  const heeftAnnotatie = !!annot.actief;
  const annotatieData = annot.actief;
  const elementenMetFeedback = annot.elementenMetFeedback;

  return (
    <div className={`chat-shell${chatStream.isStreaming ? " streaming" : ""}`}>
      {/* Achtergrond effecten */}
      <div className="chat-bg">
        <div className="chat-bg-grid" />
        <div className="chat-bg-orb1" />
        <div className="chat-bg-orb2" />
        <div className="chat-bg-orb3" />
        {/* Particles — gereduceerd van 12 naar 6 om het aantal compositor-layers
            te beperken; elke particle heeft will-change: transform (zie globals.css). */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="chat-particle"
            style={{
              width: 2 + (i % 3),
              height: 2 + (i % 3),
              left: `${(i * 16.6) % 100}%`,
              bottom: "-10px",
              animationDuration: `${10 + (i * 2.1) % 10}s`,
              animationDelay: `${(i * 1.3) % 8}s`,
            }}
          />
        ))}
      </div>

      {/* Sidebar */}
      <ChatSidebar
        groups={grouped}
        activeId={panel === "chat" ? convs.activeId : null}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={convs.deleteConversation}
        userName={userName}
        userEmail={email}
        userInitials={initials}
        userRole={role === "beheerder" ? "Beheerder" : "Jurist · Analist"}
        onSettings={() => setPanel("settings")}
        onAccount={() => setPanel("account")}
        onLogout={() => signOut({ callbackUrl: "/login" })}
        graphOnline={graphOnline}
        mobileOpen={sidebarOpen}
      />

      {/* Overlay voor mobiele sidebar */}
      {sidebarOpen && (
        <div
          className="chat-sidebar-overlay"
          aria-hidden="true"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="chat-main">
        <ChatTopbar
          title={displayTitle}
          artifactOpen={artifactOpen}
          hasArtifact={lastSources.length > 0}
          onArtifactToggle={() => setArtifactOpen(v => !v)}
          onRename={panel === "chat" && convs.activeId ? (t) => convs.renameConversation(convs.activeId!, t) : undefined}
          showScrollBtn={showScrollBtn && panel === "chat"}
          onScrollToBottom={scrollToBottom}
          onMenuOpen={() => setSidebarOpen(v => !v)}
        />

        {panel === "settings" && (
          <div ref={panelAreaRef} className="chat-panel-focus-root">
            <SettingsPanel onClose={() => setPanel("chat")} />
          </div>
        )}
        {panel === "account" && (
          <div ref={panelAreaRef} className="chat-panel-focus-root">
            <AccountPanel userid={userid} email={email} role={role} initials={initials} onClose={() => setPanel("chat")} />
          </div>
        )}
        {panel === "chat" && (
          <>
            {heeftAnnotatie ? (
              // Annotatie-workbench: wettekst + JAS-elementen + feedback
              <div className="annot-shell">
                <AnnotatieWorkbench
                  doel={annotatieData!.doel}
                  elementen={elementenMetFeedback}
                  ontbrekend={annotatieData!.ontbrekend}
                  isStreaming={chatStream.isStreaming}
                  onFeedback={handleFeedback}
                />
                {/* Samenvattings-bericht + invoer onderaan */}
                <div className="annot-bottom">
                  <ChatMessages
                    messages={active?.messages ?? []}
                    streamingContent={chatStream.answerText}
                    streamingReasoning={chatStream.reasoningText}
                    isStreaming={chatStream.isStreaming}
                    showStreaming={settings.streaming !== false}
                    showReasoning={settings.reasoning !== false}
                  />
                  <ChatInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    onAbort={chatStream.abort}
                    isStreaming={chatStream.isStreaming}
                  />
                </div>
              </div>
            ) : (
              <>
                <ChatMessages
                  messages={active?.messages ?? []}
                  streamingContent={chatStream.answerText}
                  streamingReasoning={chatStream.reasoningText}
                  isStreaming={chatStream.isStreaming}
                  showStreaming={settings.streaming !== false}
                  showReasoning={settings.reasoning !== false}
                  scrollContainerRef={messagesWrapRef}
                  welcomeNode={
                    <div className="chat-welcome">
                      <div className="chat-welcome-orb">⚖️</div>
                      <div className="chat-welcome-title">Juridische Assistent</div>
                      <div className="chat-welcome-sub">
                        Stel een vraag over Nederlandse wet- en regelgeving. Alle antwoorden zijn brongetrouw
                        onderbouwd via de juridische kennisgraaf van de Belastingdienst.
                      </div>
                      <div className="chat-welcome-chips">
                        {SUGGESTIONS.map(s => (
                          <button key={s} className="chat-welcome-chip" onClick={() => handleSubmit(s)}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  }
                />
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  onAbort={chatStream.abort}
                  isStreaming={chatStream.isStreaming}
                  streamError={streamError}
                />
              </>
            )}
          </>
        )}
      </div>

      {/* Artifact-paneel */}
      {artifactOpen && lastSources.length > 0 && (
        <ArtifactPanel
          sources={lastSources}
          groundingOk={lastGrounding}
          onClose={() => setArtifactOpen(false)}
        />
      )}
    </div>
  );
}
