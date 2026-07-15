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
  // De keuze "Ingelogd blijven op dit apparaat" is al op stap 1 (/login) gemaakt en meegedragen.
  const [onthouden, setOnthouden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  // De (niet-gevoelige) userid + remember-keuze komen uit stap 1 (/login). Ontbreekt de userid →
  // opnieuw beginnen.
  useEffect(() => {
    setUserid(sessionStorage.getItem("wa_login_userid"));
    setOnthouden(sessionStorage.getItem("wa_login_remember") === "1");
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
      // Code klopt → sessie opzetten via Auth.js (het login-ticket bewijst het wachtwoord). De
      // remember-keuze bepaalt de sessieduur (30 d vs 12 u).
      const res = await signIn("credentials", {
        redirect: false,
        userid,
        totp,
        remember: onthouden ? "1" : "0",
      });
      if (res?.error) {
        setFout("Inloggen mislukt. Begin opnieuw.");
        return;
      }
      sessionStorage.removeItem("wa_login_userid");
      sessionStorage.removeItem("wa_login_remember");
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

      {onthouden && (
        <p className="text-xs text-muted">
          Dit apparaat wordt 30 dagen onthouden; de volgende keer sla je 2FA over.
        </p>
      )}

      <Button type="submit" disabled={bezig} className="w-full">
        {bezig ? "Bezig met verifiëren…" : "Verifiëren"}
      </Button>

      <Link href="/login" className="block text-center text-sm text-muted underline">
        Terug naar inloggen
      </Link>
    </form>
  );
}
