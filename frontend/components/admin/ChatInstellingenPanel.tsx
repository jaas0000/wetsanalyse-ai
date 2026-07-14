"use client";

// Beheer van de kennisgraaf-chatbot (zwevende chatbel in de webapp): aan/uit voor alle
// gebruikers, de n8n-webhook-URL en een (write-only) secret. Alles wordt server-side in de
// API-settings bewaard; het secret verlaat de server nooit (alleen "ingesteld" is zichtbaar).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, Section } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Melding } from "@/components/ui/Melding";
import { Tag } from "@/components/ui/Badge";
import { getSettings, isApiError, updateSettings } from "@/lib/api";

function foutTekst(e: unknown): string {
  return isApiError(e) ? e.detail : (e as Error).message;
}

export function ChatInstellingenPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [webhook, setWebhook] = useState("");
  const [secret, setSecret] = useState("");
  const [secretGezet, setSecretGezet] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let levend = true;
    getSettings()
      .then((s) => {
        if (!levend) return;
        setEnabled(s.chat_enabled);
        setWebhook(s.chat_webhook_url);
        setSecretGezet(s.chat_secret_set);
      })
      .catch((e) => levend && setFout(foutTekst(e)));
    return () => {
      levend = false;
    };
  }, []);

  async function opslaan(patch: Parameters<typeof updateSettings>[0]) {
    setBezig(true);
    setFout(null);
    setOk(null);
    try {
      const s = await updateSettings(patch);
      setEnabled(s.chat_enabled);
      setWebhook(s.chat_webhook_url);
      setSecretGezet(s.chat_secret_set);
      setSecret("");
      setOk("Opgeslagen.");
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  return (
    <Section title="Kennisgraaf-chatbot" subtitle="zwevende chatbel in de webapp">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[16rem] flex-1">
            <p className="text-sm font-medium text-ink">Chatbot tonen</p>
            <p className="mt-0.5 text-xs text-muted">
              Zet voor alle ingelogde gebruikers een chatbel aan die met de kennisgraaf-agent praat.
              Vul hieronder de webhook-URL in voordat je aanzet.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {enabled !== null && <Tag>{enabled ? "aan" : "uit"}</Tag>}
            <Button
              variant={enabled ? "secondary" : "primary"}
              onClick={() => void opslaan({ chat_enabled: !enabled })}
              disabled={enabled === null || bezig || (!enabled && !webhook.trim())}
            >
              {bezig ? "Bezig…" : enabled ? "Uitzetten" : "Aanzetten"}
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">Webhook-URL (n8n Chat Trigger)</span>
            <Input
              value={webhook}
              onChange={(e) => setWebhook(e.target.value)}
              placeholder="https://n8n.ipalm.nl/webhook/…/chat"
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">
              Secret <span className="font-normal text-faint">(optioneel; {secretGezet ? "ingesteld" : "niet ingesteld"})</span>
            </span>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={secretGezet ? "•••••• (leeg = ongewijzigd)" : "gedeeld geheim (X-Chat-Secret)"}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="secondary"
              onClick={() =>
                void opslaan({ chat_webhook_url: webhook.trim(), ...(secret ? { chat_secret: secret } : {}) })
              }
              disabled={bezig}
              className="w-full sm:w-auto"
            >
              {bezig ? "Opslaan…" : "Opslaan"}
            </Button>
            {ok && <span className="text-sm text-lint">{ok}</span>}
          </div>
        </div>

        {fout && (
          <Melding type="fout" compact className="mt-3">
            {fout}
          </Melding>
        )}
      </Card>
    </Section>
  );
}
