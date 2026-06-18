"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { ButtonRow } from "@/components/ui/ButtonRow";
import { Card, Section } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Melding } from "@/components/ui/Melding";
import { Tag } from "@/components/ui/Badge";
import { activate2fa, begin2fa, disable2fa, getAccount, isApiError } from "@/lib/api";
import type { MeAccount } from "@/lib/types";

/** Haal het base32-secret uit de otpauth://-URI voor handmatige invoer in de authenticator-app. */
function secretUit(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function AccountClient() {
  const [account, setAccount] = useState<MeAccount | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // Lopende 2FA-koppeling: de QR/secret + het in te voeren code-veld.
  const [koppeling, setKoppeling] = useState<{ uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      setAccount(await getAccount());
    } catch (e) {
      setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    laad();
  }, [laad]);

  function melden(e: unknown) {
    setFout(isApiError(e) ? `${e.detail} (${e.status})` : (e as Error).message);
  }

  async function onStart() {
    setFout(null);
    setBezig(true);
    try {
      const { otpauth_uri } = await begin2fa();
      const qr = await QRCode.toDataURL(otpauth_uri, { margin: 1, width: 200 });
      setKoppeling({ uri: otpauth_uri, qr });
      setCode("");
    } catch (e) {
      melden(e);
    } finally {
      setBezig(false);
    }
  }

  async function onBevestig(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    setBezig(true);
    try {
      await activate2fa(code.trim());
      setKoppeling(null);
      setCode("");
      await laad();
    } catch (e) {
      melden(e);
    } finally {
      setBezig(false);
    }
  }

  async function onUitschakelen() {
    if (!confirm("Tweestapsverificatie uitschakelen?")) return;
    setFout(null);
    setBezig(true);
    try {
      await disable2fa();
      await laad();
    } catch (e) {
      melden(e);
    } finally {
      setBezig(false);
    }
  }

  return (
    <Section title="Tweestapsverificatie (2FA)" subtitle="Optioneel">
      {fout && (
        <Melding type="fout" className="mb-3">
          {fout}
        </Melding>
      )}

      {account && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display font-semibold text-ink">{account.userid}</span>
            <span className="text-sm text-muted">{account.email}</span>
            <Tag>{account.role}</Tag>
            {account.totp_enabled ? <Tag>2FA ✓</Tag> : <Tag>2FA uit</Tag>}
          </div>

          {account.totp_enabled ? (
            <ButtonRow align="start" className="mt-3">
              <Button variant="danger" onClick={onUitschakelen} disabled={bezig}>
                2FA uitschakelen
              </Button>
            </ButtonRow>
          ) : koppeling ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted">
                Scan de QR-code met je authenticator-app (of voer de sleutel handmatig in) en
                bevestig met de getoonde 6-cijferige code.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={koppeling.qr} alt="QR-code voor 2FA" width={200} height={200} className="rounded border border-line" />
              <p className="text-xs text-muted">
                Handmatige sleutel:{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{secretUit(koppeling.uri)}</code>
              </p>
              <form onSubmit={onBevestig} className="flex flex-wrap items-end gap-3">
                <Field label="Code uit de app" hint="6 cijfers">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={bezig}>
                  Bevestigen
                </Button>
                <Button type="button" variant="ghost" onClick={() => setKoppeling(null)} disabled={bezig}>
                  Annuleren
                </Button>
              </form>
            </div>
          ) : (
            <ButtonRow align="start" className="mt-3">
              <Button onClick={onStart} disabled={bezig}>
                2FA inschakelen
              </Button>
            </ButtonRow>
          )}
        </Card>
      )}
    </Section>
  );
}
