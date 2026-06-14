"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { createProject, isApiError, listModelProfiles, listWetten } from "@/lib/api";
import { buildStartRequest, projectSchema } from "@/lib/projectForm";
import { pathSegment } from "@/lib/url";
import type { ProfileChoice, WetChoice } from "@/lib/types";

const selectClass =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function ProjectForm() {
  const router = useRouter();
  const [review, setReview] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [veldFout, setVeldFout] = useState<Record<string, string>>({});
  const [fout, setFout] = useState<string | null>(null);
  const [profielen, setProfielen] = useState<ProfileChoice[] | null>(null);
  const [profiel, setProfiel] = useState("");
  const [wetten, setWetten] = useState<WetChoice[] | null>(null);
  const [bwbId, setBwbId] = useState("");

  // Live ophalen zodat profielen/wetten die in de draaiende app worden toegevoegd/verwijderd direct meekomen.
  useEffect(() => {
    let levend = true;
    listModelProfiles()
      .then((ps) => {
        if (!levend) return;
        setProfielen(ps);
        setProfiel((ps.find((p) => p.is_default) ?? ps[0])?.name ?? "");
      })
      .catch(() => levend && setProfielen([]));
    listWetten()
      .then((ws) => levend && setWetten(ws))
      .catch(() => levend && setWetten([]));
    return () => {
      levend = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFout(null);
    setVeldFout({});
    const fd = new FormData(e.currentTarget);
    const raw = {
      bwbId: String(fd.get("bwbId") ?? ""),
      artikel: String(fd.get("artikel") ?? ""),
      lid: String(fd.get("lid") ?? ""),
      naam: String(fd.get("naam") ?? ""),
      omschrijving: String(fd.get("omschrijving") ?? ""),
      analysefocus: String(fd.get("analysefocus") ?? ""),
      review,
      model_profile: profiel,
    };
    const parsed = projectSchema.safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
      setVeldFout(errs);
      return;
    }

    const body = buildStartRequest(parsed.data);

    setBezig(true);
    try {
      const res = await createProject(body);
      router.push(`/projecten/${pathSegment(res.id)}`);
    } catch (e) {
      if (isApiError(e)) {
        if (e.status === 429) setFout(`Te veel verzoeken. Probeer over ${e.retryAfter ?? "enkele"} s opnieuw.`);
        else if (e.status === 503) setFout(`De analyse-engine is niet beschikbaar: ${e.detail}`);
        else setFout(`${e.detail} (${e.status})`);
      } else {
        setFout((e as Error).message);
      }
      setBezig(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Wet"
            hint={wetten === null ? "laden…" : wetten.length > 0 ? "beheer via /beheer" : "BWB-id, bv. BWBR0004770"}
            error={veldFout.bwbId}
          >
            {wetten && wetten.length > 0 ? (
              <select
                name="bwbId"
                value={bwbId}
                onChange={(e) => setBwbId(e.target.value)}
                className={selectClass}
              >
                <option value="">— kies een wet —</option>
                {wetten.map((w) => (
                  <option key={w.bwbId} value={w.bwbId}>
                    {w.naam || w.bwbId}
                  </option>
                ))}
              </select>
            ) : (
              // Fallback: lege catalogus → vrije BWB-id-invoer.
              <Input
                name="bwbId"
                value={bwbId}
                onChange={(e) => setBwbId(e.target.value)}
                placeholder="BWBR0004770"
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            label="Model-profiel"
            hint={profielen === null ? "laden…" : "beheer via /beheer"}
            error={veldFout.model_profile}
          >
            {profielen && profielen.length > 0 ? (
              <select
                name="model_profile"
                value={profiel}
                onChange={(e) => setProfiel(e.target.value)}
                className={selectClass}
              >
                {profielen.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              // Fallback: geen profielen opgehaald → vrije invoer (API valt terug op de default).
              <Input
                name="model_profile"
                value={profiel}
                onChange={(e) => setProfiel(e.target.value)}
                placeholder="azure-sonnet"
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Artikel" required error={veldFout.artikel}>
            <Input name="artikel" placeholder="9" autoComplete="off" />
          </Field>
          <Field label="Lid" hint="optioneel" error={veldFout.lid}>
            <Input name="lid" placeholder="2" autoComplete="off" />
          </Field>
        </div>

        <Field label="Naam" hint="optioneel — anders afgeleid" error={veldFout.naam}>
          <Input name="naam" placeholder="Art. 9 lid 2 — erfrecht" autoComplete="off" />
        </Field>

        <Field label="Omschrijving / context" hint="optioneel" error={veldFout.omschrijving}>
          <Textarea name="omschrijving" rows={2} placeholder="Achtergrond bij deze analyse…" />
        </Field>

        <Field label="Analysefocus / onderzoeksvraag" hint="optioneel" error={veldFout.analysefocus}>
          <Textarea
            name="analysefocus"
            rows={2}
            placeholder="Waar moet de analyse antwoord op geven?"
          />
        </Field>

        <label className="flex items-start gap-3 rounded-lg border border-line bg-paper/60 p-3">
          <input
            type="checkbox"
            checked={review}
            onChange={(e) => setReview(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Human-in-the-loop review</span>
            <span className="mt-0.5 block text-muted">
              Pauzeer na activiteit 2 en 3 voor jouw beoordeling. Uit = volautomatisch tot het
              rapport (brongetrouwheid blijft hard afgedwongen).
            </span>
          </span>
        </label>

        {fout && (
          <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">
            {fout}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="submit" disabled={bezig}>
            {bezig ? "Bezig met starten…" : "Analyse starten"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
