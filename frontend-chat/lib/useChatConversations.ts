"use client";

import { useCallback, useEffect, useState } from "react";
import type { Conversation, Message } from "./chat-types";

const STORAGE_KEY = "chat_conversations";

function load(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Conversation[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function save(convs: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
  } catch { /* quota */ }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromQuestion(q: string): string {
  return q.length > 50 ? q.slice(0, 50).trimEnd() + "…" : q;
}

export function useChatConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const stored = load();
    setConversations(stored);
    if (stored.length > 0) setActiveId(stored[0].id);
  }, []);

  const active = conversations.find(c => c.id === activeId) ?? null;

  const createConversation = useCallback((question: string): Conversation => {
    const now = Date.now();
    const conv: Conversation = {
      id: uid(),
      title: titleFromQuestion(question),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setConversations(prev => {
      const next = [conv, ...prev];
      save(next);
      return next;
    });
    setActiveId(conv.id);
    return conv;
  }, []);

  const addMessage = useCallback((convId: string, msg: Omit<Message, "id" | "createdAt">) => {
    const full: Message = { ...msg, id: uid(), createdAt: Date.now() };
    setConversations(prev => {
      const next = prev.map(c => {
        if (c.id !== convId) return c;
        return { ...c, messages: [...c.messages, full], updatedAt: Date.now() };
      });
      save(next);
      return next;
    });
    return full;
  }, []);

  const updateLastMessage = useCallback((convId: string, patch: Partial<Message>) => {
    setConversations(prev => {
      const next = prev.map(c => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages];
        if (msgs.length === 0) return c;
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...patch };
        return { ...c, messages: msgs, updatedAt: Date.now() };
      });
      save(next);
      return next;
    });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      save(next);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }, [activeId]);

  const renameConversation = useCallback((id: string, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) return;
    setConversations(prev => {
      const next = prev.map(c => c.id === id ? { ...c, title } : c);
      save(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setConversations([]);
    setActiveId(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Groepeer per kalenderdag (middernacht als grens, niet glijdend 24u-venster)
  const grouped = useCallback(() => {
    const now = new Date();
    const startVandaag = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startGisteren = startVandaag - 86_400_000;
    const startWeek = startVandaag - 6 * 86_400_000;

    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const week: Conversation[] = [];
    const older: Conversation[] = [];
    for (const c of conversations) {
      if (c.updatedAt >= startVandaag) today.push(c);
      else if (c.updatedAt >= startGisteren) yesterday.push(c);
      else if (c.updatedAt >= startWeek) week.push(c);
      else older.push(c);
    }
    return { today, yesterday, week, older };
  }, [conversations]);

  return {
    conversations,
    active,
    activeId,
    setActiveId,
    createConversation,
    addMessage,
    updateLastMessage,
    deleteConversation,
    renameConversation,
    clearAll,
    grouped,
  };
}
