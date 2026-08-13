"use client";

import { useRouter } from "next/navigation";
import { AccountClient } from "@/components/account/AccountClient";
import { PasswordPanel } from "@/components/account/PasswordPanel";
import { ApiTokensPanel } from "@/components/admin/ApiTokensPanel";
import { ProfielenPanel } from "@/components/admin/ProfielenPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { Tabs, type TabDef } from "@/components/ui/Tabs";
import { INSTELLINGEN_TABS, padVanTab, type TabKey } from "@/lib/instellingen";

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
