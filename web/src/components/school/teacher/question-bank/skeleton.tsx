// Loading placeholder for the bank list. Three faded rows with a
// pulsing animation — replaces the dead "Loading…" text so the page
// doesn't feel frozen during the initial fetch.
export function BankSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <SkeletonGroupHeader />
      <div className="divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}

function SkeletonGroupHeader() {
  return (
    <div className="flex items-center gap-2 pb-1">
      <div className="h-3 w-3 animate-pulse rounded bg-bg-subtle" />
      <div className="h-3 w-32 animate-pulse rounded bg-bg-subtle" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-bg-subtle" />
      <div className="h-3 flex-1 animate-pulse rounded bg-bg-subtle" />
      <div className="hidden h-3 w-12 animate-pulse rounded bg-bg-subtle sm:block" />
    </div>
  );
}
