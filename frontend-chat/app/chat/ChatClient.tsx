"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { PanelView, Source, AnnotatieElement, AnnotatieDoel, OntbrekendItem } from "@/lib/chat-types";

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

  // Annotatie-cache: per gesprek-id bewaren we doel + elementen + ontbrekend + feedback.
  // Zo blijft de annotatie beschikbaar na een gesprekswisseling.
  type AnnotatieCache = {
    doel: AnnotatieDoel;
    elementen: AnnotatieElement[];
    ontbrekend: OntbrekendItem[];
    feedback: Record<number, { feedback: "akkoord" | "afwijzen" | "twijfel"; notitie: string }>;
  };
  const annotatieCache = useRef<Record<string, AnnotatieCache>>({});

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

  const convs = useChatConversations();
  const chatStream = useChatStream(convs.activeId);

  // Propageer stream-fouten naar de UI (moet ná chatStream-declaratie staan)
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

    // Annotatie-accumulatoren geldig voor precies dit convId
    let doelVoorConv: AnnotatieDoel | null = null;
    const elementenVoorConv: AnnotatieElement[] = [];

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
      // onAnnotatie — schrijf direct naar de cache van het juiste convId
      (event) => {
        const cached = annotatieCache.current[convId!] ?? {
          doel: null as unknown as AnnotatieDoel,
          elementen: [],
          ontbrekend: [],
          feedback: {},
        };
        if (event.type === "doel") {
          doelVoorConv = event.doel;
          annotatieCache.current[convId!] = { ...cached, doel: event.doel };
        } else if (event.type === "element") {
          elementenVoorConv.push(event.element);
          annotatieCache.current[convId!] = { ...cached, elementen: [...elementenVoorConv] };
        } else if (event.type === "ontbrekend") {
          annotatieCache.current[convId!] = { ...cached, ontbrekend: event.items };
        }
        // Trigger re-render zodat workbench live mee-update
        setAnnotatieRev(r => r + 1);
      }
    );
  }, [input, chatStream, convs, panel]);

  const grouped = convs.grouped();
  const active = convs.active;
  const displayTitle = panel === "settings" ? "Instellingen"
    : panel === "account" ? "Account"
    : active?.title ?? "";

  const userName = userid;

  // Reset feedback bij nieuw gesprek
  const handleNew = () => {
    convs.setActiveId(null);
    setPanel("chat");
  };

  // Reset feedback ook bij gesprekswisseling via sidebar
  const handleSelect = (id: string) => {
    convs.setActiveId(id);
    setPanel("chat");
    setSidebarOpen(false); // sluit sidebar op mobiel na gesprekskeuze
  };

  const handleFeedback = (idx: number, feedback: "akkoord" | "afwijzen" | "twijfel", notitie: string) => {
    const id = convs.activeId;
    if (!id) return;
    const cached = annotatieCache.current[id];
    if (!cached) return;
    annotatieCache.current[id] = {
      ...cached,
      feedback: { ...cached.feedback, [idx]: { feedback, notitie } },
    };
    // Forceer re-render door een dummy state-update
    setAnnotatieRev(r => r + 1);
  };

  // Teller om re-render te triggeren na cache-mutatie
  const [annotatieRev, setAnnotatieRev] = useState(0);

  // Lees annotatie-data uit cache (stream OF eerder gecachede waarde)
  const actieveCacheId = convs.activeId ?? "";
  const annotatieData = annotatieCache.current[actieveCacheId] ?? null;
  const heeftAnnotatie = !!annotatieData;

  const elementenMetFeedback: AnnotatieElement[] = (annotatieData?.elementen ?? []).map((el, i) => ({
    ...el,
    ...(annotatieData?.feedback[i] ?? {}),
  }));

  return (
    <div className={`chat-shell${chatStream.isStreaming ? " streaming" : ""}`}>
      {/* Achtergrond effecten */}
      <div className="chat-bg">
        <div className="chat-bg-grid" />
        <div className="chat-bg-orb1" />
        <div className="chat-bg-orb2" />
        <div className="chat-bg-orb3" />
        {/* Particles */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="chat-particle"
            style={{
              width: 2 + (i % 3),
              height: 2 + (i % 3),
              left: `${(i * 8.3) % 100}%`,
              bottom: "-10px",
              animationDuration: `${8 + (i * 1.3) % 10}s`,
              animationDelay: `${(i * 0.7) % 8}s`,
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
