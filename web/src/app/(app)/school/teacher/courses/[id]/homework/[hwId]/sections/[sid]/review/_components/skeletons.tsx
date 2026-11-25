import { Skeleton } from "@/components/ui";

// ────────────────────────────────────────────────────────────────────
// Loading skeletons — mirror the settled layout so the page redraws in
// place instead of blanking to bare text. The detail skeleton matters
// most: it fires on every student switch, the most frequent transition
// on this surface. Built from the shared `Skeleton` (a low-amplitude
// animate-pulse).
// ────────────────────────────────────────────────────────────────────

function RosterRowSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-light px-4 py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-7" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-1.5 w-1.5 rounded-full" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Loading student work…</span>
      <div className="space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-[--radius-xl] border border-border-light bg-surface p-5 shadow-sm"
        >
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReviewLoadingSkeleton() {
  return (
    <div
      className="mt-5 grid gap-5 md:grid-cols-[280px_1fr]"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading roster…</span>
      <aside className="self-start rounded-[--radius-xl] border border-border-light bg-surface shadow-sm">
        <div className="border-b border-border-light px-4 py-2.5">
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <RosterRowSkeleton key={i} />
          ))}
        </div>
      </aside>
      <section className="min-w-0">
        <DetailSkeleton />
      </section>
    </div>
  );
}
