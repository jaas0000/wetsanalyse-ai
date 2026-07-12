"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Melding } from "@/components/ui/Melding";
import { loginVerify } from "@/lib/api";

/** Gebruik alleen het pad van een callbackUrl op hetzelfde origin; voorkomt een sprong naar een
 *  ander host (bv. een intern 0.0.0.0:3000 dat door een verkeerd geconfigureerde proxy ontstaat). */
function veiligPad(cb: string | null): string {
  if (!cb) return "/";
  try {
    const u = new URL(cb, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : "/";
  } catch {
    // Alleen een echt intern pad; sluit protocol-relatieve paden (`//evil.com`) expliciet uit.
    return cb.startsWith("/") && !cb.startsWith("//") ? cb : "/";
  }
}

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [userid, setUserid] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  // Het 2FA-veld verschijnt pas zodra de API meldt dat tweestapsverificatie vereist is.
  const [tonen2fa, setTonen2fa] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    setInfo(null);
    setBezig(true);
    try {
      // Pre-check: kloppen de gegevens, en is 2FA nodig? (zet zelf nog geen sessie)
      const check = await loginVerify(userid, password, tonen2fa ? totp : undefined);

      if (check.code === "totp_required") {
        if (!tonen2fa) {
          setTonen2fa(true);
          setInfo("Tweestapsverificatie staat aan. Voer de 6-cijferige code uit je authenticator-app in.");
        } else {
          setFout("Onjuiste of verlopen 2FA-code.");
        }
        return;
      }
      if (check.code === "rate") {
        setFout("Te veel inlogpogingen. Wacht even en probeer het opnieuw.");
        return;
      }
      if (!check.ok) {
        setFout("Onjuiste gebruikersnaam of wachtwoord.");
        return;
      }

      // Gegevens kloppen → sessie opzetten via Auth.js.
      const res = await signIn("credentials", {
        redirect: false,
        userid,
        password,
        totp: tonen2fa ? totp : "",
      });
      if (res?.error) {
        setFout("Inloggen mislukt. Probeer het opnieuw.");
        return;
      }
      router.push(veiligPad(params.get("callbackUrl")));
      router.refresh();
    } finally {
      setBezig(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fout && <Melding type="fout">{fout}</Melding>}
      {info && <Melding type="uitleg">{info}</Melding>}
      <Field label="Gebruikersnaam" required>
        <Input
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={userid}
          onChange={(e) => setUserid(e.target.value)}
        />
      </Field>
      <Field label="Wachtwoord" required>
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {tonen2fa && (
        <Field label="2FA-code" hint="6 cijfers uit je authenticator-app">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
        </Field>
      )}

      <Button type="submit" disabled={bezig} className="w-full">
        {bezig ? "Bezig met inloggen…" : "Inloggen"}
      </Button>
    </form>
  );
}
