import { getProjectsServer } from "@/lib/server";
import { Card } from "@/components/ui/Card";
import { DashboardClient } from "./DashboardClient";
import type { JobSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPagina() {
  let projecten: JobSummary[] = [];
  let fout: string | null = null;
  try {
    projecten = await getProjectsServer(100);
  } catch (e) {
    fout = (e as Error).message;
  }

  if (fout) {
    return (
      <Card className="border-accent/30 bg-accent/5 p-4 text-sm text-accent">
        De API is niet bereikbaar: <span className="font-mono">{fout}</span>. Controleer{" "}
        <span className="font-mono">API_BASE_URL</span> en het token.
      </Card>
    );
  }

  return <DashboardClient initieel={projecten} />;
}
