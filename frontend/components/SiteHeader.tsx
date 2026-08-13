"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SiteNav } from "@/components/SiteNav";
import { isAppShellPad } from "@/lib/appShell";

/** Globale kop (Rijkshuisstijl-logobalk + navigatie). Weggelaten op de app-shell-paden (`/workbench`
 *  en `/instellingen`): dat is een vol-hoogte chat-app met een eigen sidebar die het logo bovenin
 *  draagt — de globale balk zou daar dubbelop zijn. Op alle andere pagina's staat de kop bovenaan. */
export function SiteHeader({ ingelogd }: { ingelogd: boolean }) {
  const pathname = usePathname();
  if (isAppShellPad(pathname)) return null;

  return (
    <header className="relative z-30">
      {/* PoC-strip: alleen zichtbaar na inloggen. */}
      {ingelogd && (
        <Link
          href="/disclaimer"
          className="block bg-waarschuwing/10 py-1.5 text-ink transition-colors hover:bg-waarschuwing/20 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lint"
        >
          <span className="mx-auto block max-w-6xl px-6 text-center text-xs">
            <span className="font-semibold">Testomgeving — proof of concept.</span>{" "}
            Analyses kunnen verloren gaan.{" "}
            <span className="underline">Lees de voorwaarden</span>
          </span>
        </Link>
      )}
      {/* Logobalk (Rijkshuisstijl): het lint op de horizontale middenas, woordmerk rechts ernaast. */}
      <div className="border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-6">
          <Link
            href="/"
            aria-label="Belastingdienst, naar startpagina"
            className="relative left-1/2 block w-fit max-w-[calc(50%+1.5625rem)] -translate-x-[1.5625rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lint"
          >
            <Image
              src="/belastingdienst-logo.svg"
              alt="Belastingdienst"
              width={275}
              height={125}
              priority
              unoptimized
              className="block h-auto w-[17.1875rem] max-w-full"
            />
          </Link>
        </div>
      </div>
      {/* Navigatiebalk — onder de logobalk. */}
      <div className="relative border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6">
          <Link
            href="/"
            className="shrink-0 py-3 text-sm font-semibold text-lint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint"
          >
            Wetsanalyse
          </Link>
          <SiteNav />
        </div>
      </div>
    </header>
  );
}
