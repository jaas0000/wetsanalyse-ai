"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode;
  className?: string;
  /** Toegankelijke naam voor het paneel (role="dialog"). */
  ariaLabel?: string;
  /** Aangeroepen vlak vóór het paneel sluit (Escape, outside-click, of toggle) — zodat de
   * aanroeper zelf de focus kan terugzetten op de trigger. Popover kent de trigger zelf niet. */
  onClose?: () => void;
}

export function Popover({ trigger, children, className = "", ariaLabel, onClose }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function close() {
    onClose?.();
    setOpen(false);
  }

  function toggle() {
    setOpen((v) => {
      if (v) onClose?.();
      return !v;
    });
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
    // Bewust alleen `open` als dependency: `close` leest onClose/setOpen via closure en hoeft
    // niet opnieuw gebonden te worden bij elke render van de aanroeper (onClose is vaak een
    // inline callback, dus een andere referentie per render — dat zou de listeners onnodig
    // laten flapperen zolang het paneel open staat).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger(open, toggle)}
      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className={`absolute right-0 top-full z-40 mt-1 ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
