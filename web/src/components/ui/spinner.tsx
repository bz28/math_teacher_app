import { cn } from "@/lib/utils";

/**
 * Simple border-spinner. Use in place of hand-rolled
 * `animate-spin rounded-full border-2 border-primary border-t-transparent`
 * divs that were scattered across the codebase.
 */
export function Spinner({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dim =
    size === "sm" ? "h-4 w-4 border-2" :
    size === "lg" ? "h-8 w-8 border-[3px]" :
    "h-5 w-5 border-2";

  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-spin rounded-full border-primary border-t-transparent",
        dim,
        className,
      )}
    />
  );
}
