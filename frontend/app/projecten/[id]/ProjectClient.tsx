"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StateBadge, Tag } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusTimeline } from "@/components/StatusTimeline";
import { ReviewPanel } from "@/components/ReviewPanel";
import { RapportView } from "@/components/RapportView";
import { getProject, getRapport, retryProject, deleteProject, isApiError } from "@/lib/api";
import { isReview, isTerminal, reviewActiviteit } from "@/lib/states";
import type { Job, Rapport } from "@/lib/types";
import { useRouter } from "next/navigation";

export function ProjectClient({ initieel }: { initieel: Job }) {
  const router = useRouter();
  const [job, setJob] = useState<Job>(initieel);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [actie, setActie] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refreshJob = useCallback(async () => {
    try {
      setJob(await getProject(initieel.id));
    } catch {
      /* tijdelijke leesfout; volgende tick probeert opnieuw */
    }
  }, [initieel.id]);

  // SSE: open zolang het project niet terminaal is; elke update triggert een verse job-fetch.
  useEffect(() => {
    if (isTerminal(job.state)) return;
    const es = new EventSource(`/api/projects/${initieel.id}/events`);
    esRef.current = es;
    es.onmessage = () => void refreshJob();
    es.addEventListener("done", () => {
      void refreshJob();
      es.close();
    });
    es.onerror = () => {
      // Browser probeert vanzelf te herverbinden; sluit alleen als we klaar zijn.
      if (isTerminal(job.state)) es.close();
    };
    return () => es.close();
    // We heropenen bewust niet bij elke state-wijziging: één stream volstaat tot terminaal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initieel.id]);

  // Sluit de stream zodra we terminaal zijn.
  useEffect(() => {
    if (isTerminal(job.state)) esRef.current?.close();
  }, [job.state]);

  // Rapport ophalen zodra klaar.
  useEffect(() => {
    if (job.state === "klaar" && !rapport) {
      getRapport(initieel.id).then(setRapport).catch(() => undefined);
    }
  }, [job.state, rapport, initieel.id]);

  async function onRetry() {
    setActie("retry");
    try {
      await retryProject(initieel.id);
      await refreshJob();
    } catch (e) {
      alert(isApiError(e) ? e.detail : (e as Error).message);
    }
    setActie(null);
  }

  async function onDelete() {
    if (!confirm("Dit project verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    setActie("delete");
    try {
      await deleteProject(initieel.id);
      router.push("/");
    } catch (e) {
      alert(isApiError(e) ? e.detail : (e as Error).message);
      setActie(null);
    }
  }

  const reviewAct = reviewActiviteit(job.state);

  return (
    <div className="animate-rise space-y-6">
      {/* Kop */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-faint hover:text-accent">
            ← Projecten
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
            {job.id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StateBadge state={job.state} />
            {job.bwbId && <Tag>{job.bwbId}</Tag>}
            {job.artikel && <Tag>art. {job.artikel}{job.lid ? ` lid ${job.lid}` : ""}</Tag>}
            {job.model_profile && <Tag>{job.model_profile}</Tag>}
            {!job.review && <Tag>volautomatisch</Tag>}
          </div>
        </div>
        <div className="flex gap-2">
          {job.state === "fout" && (
            <Button variant="primary" onClick={onRetry} disabled={actie !== null}>
              {actie === "retry" ? "Bezig…" : "Opnieuw proberen"}
            </Button>
          )}
          {isTerminal(job.state) && (
            <Button variant="danger" onClick={onDelete} disabled={actie !== null}>
              {actie === "delete" ? "Bezig…" : "Verwijderen"}
            </Button>
          )}
        </div>
      </div>

      {/* Waarschuwingen */}
      {job.waarschuwingen.length > 0 && (
        <Card className="border-gold/40 bg-gold/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gold">Waarschuwingen</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted">
            {job.waarschuwingen.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Fout */}
      {job.state === "fout" && job.error && (
        <Card className="border-accent/30 bg-accent/5 p-5">
          <p className="font-display text-lg text-accent">Analyse gestopt</p>
          <p className="mt-1 text-sm text-ink">{job.error.bericht}</p>
          <p className="mt-2 text-xs text-muted">
            Stap <span className="font-mono">{job.error.stap}</span> · klasse{" "}
            <span className="font-mono">{job.error.klasse}</span>
            {job.error.ronde != null && <> · ronde {job.error.ronde}</>}
          </p>
        </Card>
      )}

      {/* Hoofdinhoud per fase */}
      {job.state === "klaar" ? (
        rapport ? (
          <RapportView rapport={rapport} projectId={job.id} />
        ) : (
          <Card className="p-6 text-sm text-muted">Rapport laden…</Card>
        )
      ) : reviewAct ? (
        <ReviewPanel job={job} activiteit={reviewAct} onSubmitted={refreshJob} />
      ) : job.state !== "fout" ? (
        <Card className="p-6">
          <p className="mb-4 text-sm text-muted">
            De analyse loopt. Deze pagina werkt live bij via een server-stream.
          </p>
          <StatusTimeline job={job} />
        </Card>
      ) : null}

      {/* Provenance (audit) */}
      {job.provenance.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-faint hover:text-ink">
            Herkomst &amp; audit ({job.provenance.length} ronden)
          </summary>
          <Card className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-faint">
                  <th className="px-3 py-2 font-medium">Act.</th>
                  <th className="px-3 py-2 font-medium">Ronde</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Tokens</th>
                  <th className="px-3 py-2 font-medium">MCP-versie</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {job.provenance.map((p, i) => (
                  <tr key={i} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2">{p.activiteit}</td>
                    <td className="px-3 py-2">{p.ronde}</td>
                    <td className="px-3 py-2">{p.model || "—"}</td>
                    <td className="px-3 py-2">{p.provider || "—"}</td>
                    <td className="px-3 py-2">{p.tokens_in}/{p.tokens_out}</td>
                    <td className="px-3 py-2">{p.mcp_versiedatum || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </details>
      )}
    </div>
  );
}
