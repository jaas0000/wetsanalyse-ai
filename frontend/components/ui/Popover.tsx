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
  /** Volledige positionering van het paneel (plaatsing én richting), relatief aan de wrapper.
   * Default `right-0 top-full mt-1`: onder de trigger, naar links uitklappend. De aanroeper bepaalt
   * dit zelf omdat alleen die weet hoeveel ruimte er is — in een smalle kolom is `inset-x-3 top-full`
   * (volle kolombreedte) juist, en boven aan een scherm `bottom-full mb-1` (omhoog uitklappend). */
  positie?: string;
  /** Klassen van de wrapper om trigger + paneel. Default `relative`, zodat het paneel aan de
   * trigger hangt. Zet dit op `static` als een parent het ankerpunt moet zijn — bijvoorbeeld om
   * het paneel de volle breedte van een kolom te laten volgen in plaats van die van de knop. */
  containerClassName?: string;
}

export function Popover({ trigger, children, className = "", ariaLabel, onClose, positie = "right-0 top-full mt-1", containerClassName = "relative" }: PopoverProps) {
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
    <div ref={ref} className={containerClassName}>
      {trigger(open, toggle)}
      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className={`absolute z-40 ${positie} ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
