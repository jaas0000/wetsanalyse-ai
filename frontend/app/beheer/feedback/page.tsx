import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FeedbackLijstClient } from "@/components/admin/FeedbackLijstClient";

export const metadata = { title: "Gebruikersfeedback · Beheer · Wetsanalyse" };

export default async function FeedbackBeheerPagina() {
  const session = await auth();
  if (session?.user?.role !== "beheerder") redirect("/");

  return (
    <div className="animate-rise mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-lint">Gebruikersfeedback</h1>
        <p className="mt-1 text-sm text-muted">Ingezonden feedback van gebruikers, nieuwste eerst.</p>
      </div>
      <FeedbackLijstClient />
    </div>
  );
}
