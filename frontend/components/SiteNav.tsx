"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkButton } from "@/components/ui/Button";

const ITEMS = [
  { href: "/", label: "Projecten" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/beheer", label: "Beheer" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavItem({
  href,
  label,
  active,
  onClick,
  block,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
  block?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative px-3 py-3.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint ${
        block ? "w-full" : ""
      } ${active ? "text-lint" : "text-muted hover:text-lint"}`}
    >
      {label}
      {active && (
        <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-lint" />
      )}
    </Link>
  );
}

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Desktop: nav inline, naast de applicatienaam in de navigatiebalk */}
      <nav className="hidden items-center gap-1 sm:flex">
        {ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            active={isActive(pathname, item.href)}
          />
        ))}
        <LinkButton href="/nieuw" size="sm" className="ml-2">
          Nieuwe analyse
        </LinkButton>
      </nav>

      {/* Mobiel: hamburger-toggle */}
      <button
        type="button"
        aria-label={open ? "Menu sluiten" : "Menu openen"}
        aria-expanded={open}
        aria-controls="mobiel-menu"
        onClick={() => setOpen((v) => !v)}
        className="my-2 inline-flex shrink-0 items-center justify-center rounded-button border border-line p-2 text-lint transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lint sm:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {/* Mobiel: uitklappaneel onder de navigatiebalk */}
      {open && (
        <div
          id="mobiel-menu"
          className="absolute inset-x-0 top-full z-20 flex flex-col gap-1 border-b border-line bg-paper px-6 py-3 shadow-sm sm:hidden"
        >
          {ITEMS.map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={isActive(pathname, item.href)}
              onClick={() => setOpen(false)}
              block
            />
          ))}
          <LinkButton href="/nieuw" className="mt-1 w-full" onClick={() => setOpen(false)}>
            Nieuwe analyse
          </LinkButton>
        </div>
      )}
    </>
  );
}
