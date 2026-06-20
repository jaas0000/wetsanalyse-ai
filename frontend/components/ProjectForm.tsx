"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ButtonRow } from "@/components/ui/ButtonRow";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Melding } from "@/components/ui/Melding";
import { createProject, isApiError, listModelProfiles, listWetten } from "@/lib/api";
import { buildStartRequest, legeBron, projectSchema, type BronFormValue } from "@/lib/projectForm";
import { pathSegment } from "@/lib/url";
import type { ProfileChoice, WetChoice } from "@/lib/types";

export function ProjectForm() {
  const router = useRouter();
  const [review, setReview] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [veldFout, setVeldFout] = useState<Record<string, string>>({});
  const [fout, setFout] = useState<string | null>(null);
  const [profielen, setProfielen] = useState<ProfileChoice[] | null>(null);
  const [profiel, setProfiel] = useState("");
  const [wetten, setWetten] = useState<WetChoice[] | null>(null);
  // Het werkgebied: één of meer bronnen (wet + artikel + lid).
  const [bronnen, setBronnen] = useState<BronFormValue[]>([legeBron()]);

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

  function updateBron(i: number, patch: Partial<BronFormValue>) {
    setBronnen((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
  function voegBronToe() {
    setBronnen((bs) => [...bs, legeBron()]);
  }
  function verwijderBron(i: number) {
    setBronnen((bs) => (bs.length > 1 ? bs.filter((_, j) => j !== i) : bs));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFout(null);
    setVeldFout({});
    const fd = new FormData(e.currentTarget);
    const raw = {
      bronnen,
      naam: String(fd.get("naam") ?? ""),
      omschrijving: String(fd.get("omschrijving") ?? ""),
      analysefocus: String(fd.get("analysefocus") ?? ""),
      review,
      model_profile: profiel,
    };
    const parsed = projectSchema.safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        // bron-veldfouten op "bronnen.<index>.<veld>"; overige op het topveld.
        if (issue.path[0] === "bronnen" && typeof issue.path[1] === "number") {
          errs[`bronnen.${issue.path[1]}.${String(issue.path[2] ?? "")}`] = issue.message;
        } else {
          errs[String(issue.path[0])] = issue.message;
        }
      }
      setVeldFout(errs);
      return;
    }

    const body = buildStartRequest(parsed.data);

    setBezig(true);
    try {
      const res = await createProject(body);
      // Invalideer de Router Cache zodat een latere terugkeer naar `/` de nieuwe analyse meteen toont
      // (anders serveert de cache de oude lijst). `bezig` blijft true tot de detailpagina rendert —
      // samen met de route-`loading.tsx` geeft dat directe navigatiefeedback.
      router.refresh();
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

  const heeftCatalogus = wetten !== null && wetten.length > 0;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink">Bronnen in het werkgebied</span>
            <span className="text-xs text-muted">
              {bronnen.length} bron{bronnen.length === 1 ? "" : "nen"}
            </span>
          </div>
          {veldFout.bronnen && <Melding type="fout">{veldFout.bronnen}</Melding>}

          {bronnen.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-paper/60 p-3 sm:grid-cols-[1fr_auto_auto_auto]"
            >
              <Field label="Wet" error={veldFout[`bronnen.${i}.bwbId`]}>
                {heeftCatalogus ? (
                  <Select value={b.bwbId} onChange={(e) => updateBron(i, { bwbId: e.target.value })}>
                    <option value="">— kies een wet —</option>
                    {wetten!.map((w) => (
                      <option key={w.bwbId} value={w.bwbId}>
                        {w.naam || w.bwbId}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={b.bwbId}
                    onChange={(e) => updateBron(i, { bwbId: e.target.value })}
                    placeholder="BWBR0004770"
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Artikel" required error={veldFout[`bronnen.${i}.artikel`]}>
                <Input
                  value={b.artikel}
                  onChange={(e) => updateBron(i, { artikel: e.target.value })}
                  placeholder="9"
                  autoComplete="off"
                  className="sm:w-24"
                />
              </Field>
              <Field label="Lid" hint="optioneel" error={veldFout[`bronnen.${i}.lid`]}>
                <Input
                  value={b.lid}
                  onChange={(e) => updateBron(i, { lid: e.target.value })}
                  placeholder="2"
                  autoComplete="off"
                  className="sm:w-20"
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => verwijderBron(i)}
                  disabled={bronnen.length === 1}
                  aria-label="Bron verwijderen"
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={voegBronToe}>
            + Bron toevoegen
          </Button>
        </div>

        <Field
          label="Model-profiel"
          hint={profielen === null ? "laden…" : "beheer via /beheer"}
          error={veldFout.model_profile}
        >
          {profielen && profielen.length > 0 ? (
            <Select name="model_profile" value={profiel} onChange={(e) => setProfiel(e.target.value)}>
              {profielen.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.is_default ? " (default)" : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              name="model_profile"
              value={profiel}
              onChange={(e) => setProfiel(e.target.value)}
              placeholder="azure-sonnet"
              autoComplete="off"
            />
          )}
        </Field>

        <Field label="Naam werkgebied" hint="optioneel — anders afgeleid" error={veldFout.naam}>
          <Input name="naam" placeholder="Inkomensafhankelijke bijdrage Zvw" autoComplete="off" />
        </Field>

        <Field label="Omschrijving / context" hint="optioneel" error={veldFout.omschrijving}>
          <Textarea name="omschrijving" rows={2} placeholder="Achtergrond bij deze analyse…" />
        </Field>

        <Field label="Hoofdvraag / analysefocus" hint="optioneel" error={veldFout.analysefocus}>
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

        {fout && <Melding type="fout">{fout}</Melding>}

        <ButtonRow className="pt-2">
          <Button type="submit" disabled={bezig}>
            {bezig ? "Bezig met starten…" : "Analyse starten"}
          </Button>
        </ButtonRow>
      </form>
    </Card>
  );
}
