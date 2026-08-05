import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

// Suspense-fallback tijdens de server-render (de home leidt door naar de werkruimte).
export default function Laden() {
  return (
    <div className="animate-rise space-y-8" aria-busy="true">
      <span className="sr-only">Laden…</span>
      <div className="rounded-button bg-lint px-6 py-8 sm:px-10 sm:py-10">
        <Skeleton className="h-3 w-40 bg-paper/30" />
        <Skeleton className="mt-3 h-8 w-48 bg-paper/30" />
        <Skeleton className="mt-3 h-4 w-full max-w-prose bg-paper/30" />
      </div>
      <SkeletonCard regels={6} />
    </div>
  );
}
