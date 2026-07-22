"use client";

import type { Source } from "@/lib/chat-types";
import { SourcesCard } from "./SourcesCard";

interface Props {
  sources: Source[];
  groundingOk: boolean | null;
  onClose: () => void;
}

export default function ArtifactPanel({ sources, groundingOk, onClose }: Props) {
  return (
    <aside className="chat-artifact">
      <div className="chat-artifact-header">
        <span className="chat-artifact-header-title">Bronnen & grounding</span>
        <button className="chat-artifact-close" onClick={onClose} title="Sluiten">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="chat-artifact-body">
        <SourcesCard sources={sources} groundingOk={groundingOk} noCollapse />
      </div>
    </aside>
  );
}
