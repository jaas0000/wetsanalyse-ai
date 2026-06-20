import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

// Suspense-fallback voor het dashboard tijdens de server-render.
export default function Laden() {
  return (
    <div className="animate-rise space-y-6" aria-busy="true">
      <span className="sr-only">Dashboard laden…</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} regels={3} />
        ))}
      </div>
    </div>
  );
}
