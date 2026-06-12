"use client";

import { Card, Section } from "@/components/ui/Card";
import { JasBadge, Tag } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import type { Markering, Rapport } from "@/lib/types";

function Twijfel({ tekst }: { tekst?: string }) {
  if (!tekst) return null;
  return (
    <p className="mt-2 rounded border border-gold/40 bg-gold/5 px-2 py-1 text-xs text-gold">
      Twijfel: {tekst}
    </p>
  );
}

function Veld({ label, waarde }: { label: string; waarde?: string }) {
  if (!waarde) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 text-xs uppercase tracking-wide text-faint">{label}</span>
      <span className="text-muted">{waarde}</span>
    </div>
  );
}

export function RapportView({ rapport, projectId }: { rapport: Rapport; projectId: string }) {
  const markeringenPerKlasse = groepeer(rapport.markeringen ?? []);

  return (
    <div className="space-y-10">
      {/* Kop */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">
              {rapport.wet || "Wetsanalyse"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Artikel {rapport.artikel}
              {rapport.type ? ` · ${rapport.type}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {rapport.bwbId && <Tag>{rapport.bwbId}</Tag>}
              {rapport.versiedatum && <Tag>versie {rapport.versiedatum}</Tag>}
              {rapport.bronreferentie && (
                <a
                  href={rapport.bronreferentie}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-md border border-line bg-paper px-2 py-0.5 font-mono text-xs text-accent hover:underline"
                >
                  bron ↗
                </a>
              )}
            </div>
          </div>
          <LinkButton href={`/api/projects/${projectId}/rapport-md`} variant="secondary">
            Download .md
          </LinkButton>
        </div>
        {(rapport.analysefocus || rapport.reikwijdte || rapport.geraadpleegde) && (
          <div className="mt-4 space-y-1.5 border-t border-line pt-4">
            <Veld label="Focus" waarde={rapport.analysefocus} />
            <Veld label="Reikwijdte" waarde={rapport.reikwijdte} />
            <Veld label="Geraadpleegd" waarde={rapport.geraadpleegde} />
          </div>
        )}
      </Card>

      {/* Leden */}
      {rapport.leden?.length > 0 && (
        <Section title="Wettekst per lid" count={rapport.leden.length}>
          <div className="space-y-3">
            {rapport.leden.map((l) => (
              <Card key={l.lid} className="p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-xs text-faint">lid {l.lid}</span>
                  {l.bronreferentie && (
                    <a
                      href={l.bronreferentie}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      bron ↗
                    </a>
                  )}
                </div>
                <p className="mt-1 font-display text-[15px] leading-relaxed text-ink">{l.tekst}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Markeringen per JAS-klasse */}
      {rapport.markeringen?.length > 0 && (
        <Section
          title="Markeringen & classificatie"
          count={rapport.markeringen.length}
          subtitle="activiteit 2"
        >
          <div className="space-y-6">
            {markeringenPerKlasse.map(([klasse, items]) => (
              <div key={klasse}>
                <div className="mb-2 flex items-center gap-2">
                  <JasBadge klasse={klasse} />
                  <span className="font-mono text-xs text-faint">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((m) => (
                    <Card key={m.id} className="p-4">
                      <p className="font-display text-[15px] leading-relaxed text-ink">
                        “{m.formulering}”
                      </p>
                      <div className="mt-2 space-y-1">
                        <Veld label="Vindplaats" waarde={m.vindplaats} />
                        <Veld label="Toelichting" waarde={m.toelichting} />
                      </div>
                      <Twijfel tekst={m.twijfel} />
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Samenhang */}
      {rapport.samenhang && (
        <Section title="Samenhang">
          <Card className="p-4">
            <p className="text-sm leading-relaxed text-muted">{rapport.samenhang}</p>
          </Card>
        </Section>
      )}

      {/* Begrippen */}
      {rapport.begrippen?.length > 0 && (
        <Section title="Begrippen" count={rapport.begrippen.length} subtitle="activiteit 3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rapport.begrippen.map((b) => (
              <Card key={b.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-base font-medium text-ink">{b.naam}</p>
                  {b.klasse && <JasBadge klasse={b.klasse} />}
                </div>
                <div className="mt-2 space-y-1">
                  <Veld label="Definitie" waarde={b.definitie} />
                  <Veld label="Voorbeeld" waarde={b.voorbeeld} />
                  <Veld label="Kenmerken" waarde={b.kenmerken} />
                  <Veld label="Vindplaats" waarde={b.vindplaats} />
                </div>
                <Twijfel tekst={b.twijfel} />
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Afleidingsregels */}
      {rapport.afleidingsregels?.length > 0 && (
        <Section title="Afleidingsregels" count={rapport.afleidingsregels.length} subtitle="activiteit 3">
          <div className="space-y-3">
            {rapport.afleidingsregels.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-base font-medium text-ink">{r.naam}</p>
                  {r.type && <Tag>{r.type}</Tag>}
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <Veld label="Uitvoer" waarde={r.uitvoervariabele} />
                  <Veld label="Invoer" waarde={r.invoervariabelen} />
                  <Veld label="Parameters" waarde={r.parameters} />
                  <Veld label="Vindplaats" waarde={r.vindplaats} />
                </div>
                <div className="mt-1 space-y-1">
                  <Veld label="Voorwaarden" waarde={r.voorwaarden} />
                  <Veld label="Formulering" waarde={r.formulering} />
                </div>
                <Twijfel tekst={r.twijfel} />
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Validatiepunten */}
      {rapport.validatiepunten?.length > 0 && (
        <Section title="Validatiepunten" count={rapport.validatiepunten.length}>
          <Card className="p-4">
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              {rapport.validatiepunten.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {/* Reviewlog */}
      <Reviewlog rapport={rapport} />

      {/* Aandachtspunten */}
      {rapport.aandachtspunten && (
        <Section title="Aandachtspunten">
          <Card className="p-4">
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
              {rapport.aandachtspunten}
            </p>
          </Card>
        </Section>
      )}
    </div>
  );
}

function groepeer(markeringen: Markering[]): [string, Markering[]][] {
  const map = new Map<string, Markering[]>();
  for (const m of markeringen) {
    const k = m.klasse || "Overig";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m);
  }
  return [...map.entries()];
}

function Reviewlog({ rapport }: { rapport: Rapport }) {
  const log = rapport.reviewlog ?? {};
  const blokken = (["activiteit2", "activiteit3"] as const)
    .map((k) => ({ key: k, data: log[k] }))
    .filter((b) => b.data && (b.data.samenvatting || (b.data.rondes?.length ?? 0) > 0));
  if (blokken.length === 0) return null;

  return (
    <Section title="Reviewlog">
      <div className="space-y-3">
        {blokken.map(({ key, data }) => (
          <details key={key} className="rounded-xl border border-line bg-surface/80 p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {key === "activiteit2" ? "Activiteit 2" : "Activiteit 3"}
              {data?.rondes?.length ? (
                <span className="ml-2 font-mono text-xs text-faint">
                  {data.rondes.length} ronde(n)
                </span>
              ) : null}
            </summary>
            {data?.samenvatting && (
              <p className="mt-2 text-sm text-muted">{data.samenvatting}</p>
            )}
            <div className="mt-3 space-y-2">
              {data?.rondes?.map((r) => (
                <div key={r.ronde} className="rounded border border-line/60 bg-paper/50 p-3 text-sm">
                  <p className="font-mono text-xs text-faint">ronde {r.ronde}</p>
                  {r.algemeen && <p className="mt-1 text-muted">{r.algemeen}</p>}
                  {Object.entries(r.items ?? {}).length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(r.items).map(([id, opm]) => (
                        <li key={id} className="text-muted">
                          <span className="font-mono text-xs text-faint">{id}:</span> {opm}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}
