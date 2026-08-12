import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { InstellingenInhoud, isAdminTab, tabUitPad } from "@/components/instellingen/InstellingenInhoud";

export const metadata = { title: "Instellingen · Wetsanalyse" };

/** De volledige instellingenpagina: wat je krijgt bij een directe link, een refresh of navigatie
 *  van buiten de werkplek. Vanuit de werkplek onderschept `app/@modal/(.)instellingen/…` dit pad en
 *  toont dezelfde inhoud als dialog. */
export default async function InstellingenPagina({
  params,
}: {
  params: Promise<{ tab?: string[] }>;
}) {
  const { tab } = await params;
  const actief = tabUitPad(tab);
  const session = await auth();
  const isBeheerder = session?.user?.role === "beheerder";

  // Tweede slot náást de rolgate in auth.config.ts, net als het oude app/beheer/page.tsx.
  if (isAdminTab(actief) && !isBeheerder) redirect("/");

  return (
    <div className="animate-rise mx-auto max-w-4xl">
      <h1 className="mb-6 font-display text-3xl font-semibold text-lint">Instellingen</h1>
      <div className="flex min-h-[28rem] overflow-hidden rounded-vorm border border-line bg-paper">
        <InstellingenInhoud actief={actief} isBeheerder={isBeheerder} />
      </div>
    </div>
  );
}
