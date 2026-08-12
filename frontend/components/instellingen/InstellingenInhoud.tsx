"use client";

import { useRouter } from "next/navigation";
import { AccountClient } from "@/components/account/AccountClient";
import { PasswordPanel } from "@/components/account/PasswordPanel";
import { ApiTokensPanel } from "@/components/admin/ApiTokensPanel";
import { ProfielenPanel } from "@/components/admin/ProfielenPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { Tabs, type TabDef } from "@/components/ui/Tabs";

/** De tabs, met hun pad-segment. Beheer-tabs staan onder `beheer/` zodat de rolgate in
 *  `auth.config.ts` één `startsWith("/instellingen/beheer")` blijft in plaats van een lijst namen. */
export const INSTELLINGEN_TABS = [
  { key: "account", pad: "account", label: "Account", admin: false },
  { key: "beveiliging", pad: "beveiliging", label: "Beveiliging", admin: false },
  { key: "modelprofielen", pad: "beheer/modelprofielen", label: "Modelprofielen", admin: true },
  { key: "gebruikers", pad: "beheer/gebruikers", label: "Gebruikers", admin: true },
  { key: "api-tokens", pad: "beheer/api-tokens", label: "API-tokens", admin: true },
] as const;

export type TabKey = (typeof INSTELLINGEN_TABS)[number]["key"];

/** Pad-segmenten (`["beheer","gebruikers"]`) → tabsleutel. Onbekend of leeg → `account`. */
export function tabUitPad(segmenten: string[] | undefined): TabKey {
  const pad = (segmenten ?? []).join("/");
  return INSTELLINGEN_TABS.find((t) => t.pad === pad)?.key ?? "account";
}

export function padVanTab(key: TabKey): string {
  const tab = INSTELLINGEN_TABS.find((t) => t.key === key);
  return `/instellingen/${tab ? tab.pad : "account"}`;
}

/** Is deze tab alleen voor beheerders? */
export function isAdminTab(key: TabKey): boolean {
  return INSTELLINGEN_TABS.find((t) => t.key === key)?.admin ?? false;
}

const PANEEL: Record<TabKey, React.ReactNode> = {
  account: <PasswordPanel />,
  beveiliging: <AccountClient />,
  modelprofielen: <ProfielenPanel />,
  gebruikers: <UsersPanel />,
  "api-tokens": <ApiTokensPanel />,
};

interface Props {
  actief: TabKey;
  isBeheerder: boolean;
  /** In de dialog wisselen we van tab met `replace` (geen extra history-entry per tab, zodat de
   *  back-knop de dialog sluit i.p.v. door de tabs terug te lopen). Op de volle pagina `push`. */
  vervangHistorie?: boolean;
}

/** De inhoud van het instellingenvenster: tabkolom links, paneel rechts. Wordt gedeeld door de
 *  dialog (vanuit de werkplek) en de volledige pagina (directe link/refresh), zodat beide dezelfde
 *  panelen tonen. */
export function InstellingenInhoud({ actief, isBeheerder, vervangHistorie = false }: Props) {
  const router = useRouter();
  const zichtbaar = INSTELLINGEN_TABS.filter((t) => !t.admin || isBeheerder);

  const tabs: TabDef[] = zichtbaar.map((t) => ({
    key: t.key,
    label: t.label,
    content: PANEEL[t.key],
  }));

  return (
    <Tabs
      tabs={tabs}
      active={actief}
      label="Instellingen"
      orientation="vertical"
      lazy
      onChange={(key) => {
        const pad = padVanTab(key as TabKey);
        if (vervangHistorie) router.replace(pad);
        else router.push(pad);
      }}
    />
  );
}
