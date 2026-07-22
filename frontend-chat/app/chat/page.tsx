import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = session.user as {
    userid?: string;
    email?: string | null;
    role?: string;
  };

  const userid = user.userid ?? "";
  const email = user.email ?? "";
  const role = (user.role as string) ?? "analist";

  // Initialen: eerste letters van woorden in userid (max 2)
  const initials = userid
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("") || "??";

  return (
    <ChatClient
      userid={userid}
      email={email}
      role={role}
      initials={initials}
    />
  );
}
