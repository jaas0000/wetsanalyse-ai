"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Melding } from "@/components/ui/Melding";
import { login2fa } from "@/lib/api";

/** Alleen een intern pad op hetzelfde origin (zie LoginClient.veiligPad). */
function veiligPad(cb: string | null): string {
  if (!cb) return "/";
  try {
    const u = new URL(cb, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : "/";
  } catch {
    return cb.startsWith("/") && !cb.startsWith("//") ? cb : "/";
  }
}

export function TwoFactorClient() {
  const router = useRouter();
  const params = useSearchParams();
  // undefined = sessionStorage nog niet gelezen; null = afwezig (opnieuw beginnen); string = ok.
  const [userid, setUserid] = useState<string | null | undefined>(undefined);
  const [totp, setTotp] = useState("");
  const [onthouden, setOnthouden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  // De (niet-gevoelige) userid komt uit stap 1 (/login). Ontbreekt die → opnieuw beginnen.
  useEffect(() => {
    setUserid(sessionStorage.getItem("wa_login_userid"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userid) return;
    setFout(null);
    setBezig(true);
    try {
      const check = await login2fa(userid, totp, onthouden);
      if (check.code === "rate") {
        setFout("Te veel pogingen. Wacht even en probeer het opnieuw.");
        return;
      }
      if (!check.ok) {
        setFout("Onjuiste of verlopen code. Probeer het opnieuw.");
        return;
      }
      // Code klopt → sessie opzetten via Auth.js (het login-ticket bewijst het wachtwoord).
      const res = await signIn("credentials", { redirect: false, userid, totp });
      if (res?.error) {
        setFout("Inloggen mislukt. Begin opnieuw.");
        return;
      }
      sessionStorage.removeItem("wa_login_userid");
      router.push(veiligPad(params.get("callbackUrl")));
      router.refresh();
    } finally {
      setBezig(false);
    }
  }

  if (userid === undefined) return null; // nog niet gelezen — geen flits van de foutmelding

  if (userid === null) {
    // Geen userid uit stap 1 → rechtstreeks hierheen genavigeerd of sessie verlopen.
    return (
      <div className="space-y-4">
        <Melding type="fout">
          Je sessie voor tweestapsverificatie is verlopen of ontbreekt.
        </Melding>
        <Link href="/login" className="text-sm text-lint underline">
          Terug naar inloggen
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fout && <Melding type="fout">{fout}</Melding>}
      <Field label="2FA-code" hint="6 cijfers uit je authenticator-app" required>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 accent-lint"
          checked={onthouden}
          onChange={(e) => setOnthouden(e.target.checked)}
        />
        Dit apparaat 30 dagen onthouden
      </label>

      <Button type="submit" disabled={bezig} className="w-full">
        {bezig ? "Bezig met verifiëren…" : "Verifiëren"}
      </Button>

      <Link href="/login" className="block text-center text-sm text-muted underline">
        Terug naar inloggen
      </Link>
    </form>
  );
}
