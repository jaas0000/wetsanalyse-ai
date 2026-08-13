"use client";

import { usePathname } from "next/navigation";

import { isAppShellPad } from "@/lib/appShell";

/** De hoofd-container. Op de app-shell-paden (`/workbench`, `/instellingen`) vol-bleed en op
 *  viewport-hoogte (de chat-app beheert zijn eigen sidebar/scroll); elders de normale, gecentreerde
 *  documentflow. `/instellingen` hoort erbij omdat het als dialog over de werkplek opent: die moet
 *  zijn hoogte houden terwijl de URL verandert. */
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAppShellPad(pathname)) {
    return <main className="h-[100dvh] overflow-hidden">{children}</main>;
  }
  return <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>;
}
