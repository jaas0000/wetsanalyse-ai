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
  const [onthouden, setOnthouden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFout(null);
    setBezig(true);
    try {
      // Pre-check: kloppen de gegevens, en is 2FA nodig? (zet zelf nog geen sessie)
      const check = await loginVerify(userid, password);

      if (check.code === "rate") {
        setFout("Te veel inlogpogingen. Wacht even en probeer het opnieuw.");
        return;
      }
      if (check.code === "totp_required") {
        // 2FA nodig én dit apparaat is niet (meer) vertrouwd → naar het aparte 2FA-scherm. Draag de
        // niet-gevoelige userid + de remember-keuze + callbackUrl mee; het login-ticket (httpOnly
        // cookie) draagt het wachtwoord-bewijs, zodat het wachtwoord het geheugen niet verlaat.
        sessionStorage.setItem("wa_login_userid", userid);
        sessionStorage.setItem("wa_login_remember", onthouden ? "1" : "0");
        const cb = params.get("callbackUrl");
        router.push(cb ? `/login/2fa?callbackUrl=${encodeURIComponent(cb)}` : "/login/2fa");
        return;
      }
      if (!check.ok) {
        setFout("Onjuiste gebruikersnaam of wachtwoord.");
        return;
      }

      // Gegevens kloppen (geen 2FA, of een vertrouwd apparaat) → sessie opzetten via Auth.js.
      const res = await signIn("credentials", {
        redirect: false,
        userid,
        password,
        remember: onthouden ? "1" : "0",
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

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-lint"
          checked={onthouden}
          onChange={(e) => setOnthouden(e.target.checked)}
        />
        <span>
          Ingelogd blijven op dit apparaat
          <span className="block text-xs text-muted">
            30 dagen ingelogd blijven en 2FA overslaan op dit apparaat.
          </span>
        </span>
      </label>

      <Button type="submit" disabled={bezig} className="w-full">
        {bezig ? "Bezig met inloggen…" : "Inloggen"}
      </Button>
    </form>
  );
}
