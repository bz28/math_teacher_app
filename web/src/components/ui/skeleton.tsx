import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[--radius-md] bg-border-light",
        className,
      )}
    />
  );
}

/** Skeleton for a text line. */
export function SkeletonText({ className }: SkeletonProps) {
  return <Skeleton className={cn("h-4 w-3/4", className)} />;
}

/** Skeleton for a card with title + body text. */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-[--radius-lg] border border-border-light bg-surface p-5 space-y-3",
        className,
      )}
    >
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

/** Skeleton for a step in the learn session. */
export function SkeletonStep({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-[--radius-lg] border border-border-light bg-surface p-5 space-y-4",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-5 w-1/3" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-11 w-full rounded-[--radius-md]" />
    </div>
  );
}
