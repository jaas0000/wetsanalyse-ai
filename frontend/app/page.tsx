import { getProjectsServer } from "@/lib/server";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProjectenLijstClient } from "./ProjectenLijstClient";
import type { JobSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectenPagina() {
  let projecten: JobSummary[] = [];
  let fout: string | null = null;
  try {
    projecten = await getProjectsServer();
  } catch (e) {
    fout = (e as Error).message;
  }

  return (
    <div className="animate-rise space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Analyses</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Elke analyse duidt één wetsartikel (of lid) brongetrouw volgens het Juridisch
            Analyseschema: markeren &amp; classificeren, daarna begrippen &amp; afleidingsregels.
          </p>
        </div>
        <LinkButton href="/nieuw" className="w-full sm:w-auto sm:self-start">
          Nieuwe analyse
        </LinkButton>
      </div>

      {fout ? (
        <Card className="border-accent/30 bg-accent/5 p-4 text-sm text-accent">
          De API is niet bereikbaar: <span className="font-mono">{fout}</span>. Controleer{" "}
          <span className="font-mono">API_BASE_URL</span> en het token.
        </Card>
      ) : (
        <ProjectenLijstClient initieel={projecten} />
      )}
    </div>
  );
}
