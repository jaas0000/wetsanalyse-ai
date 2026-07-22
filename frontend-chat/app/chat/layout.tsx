// Auth-bewaking loopt via de middleware (proxy.ts) — geen extra auth()-call nodig hier.
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
