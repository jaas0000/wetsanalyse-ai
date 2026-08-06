"use client";

import { usePathname } from "next/navigation";

/** De hoofd-container. Op de werkplek (`/workbench`) vol-bleed en op viewport-hoogte (de chat-app
 *  beheert zijn eigen sidebar/scroll); elders de normale, gecentreerde documentflow. */
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/workbench") {
    return <main className="h-[100dvh] overflow-hidden">{children}</main>;
  }
  return <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>;
}
