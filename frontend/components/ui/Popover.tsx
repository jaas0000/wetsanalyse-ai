"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode;
  className?: string;
}

export function Popover({ trigger, children, className = "" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div className={`absolute right-0 top-full z-40 mt-1 ${className}`}>
          {children}
        </div>
      )}
    </div>
  );
}
