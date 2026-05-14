import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "error" | "warning" | "info" | "muted";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

// Small-caps editorial badge. Flat tint with hairline border. 2px corner
// radius reads as a label rather than a pill. Mirrors the dashboard
// .badge family — tracked uppercase, 10.5px / 600.
const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-success-light text-success border-success-border",
  error: "bg-error-light text-error border-error-border",
  warning: "bg-warning-bg text-warning-dark border-warning/30",
  info: "bg-primary-bg text-primary border-primary/20",
  muted: "bg-border-light text-text-muted border-border",
};

export function Badge({ variant = "info", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[2px] border px-2 py-[3px]",
        "text-[10.5px] font-semibold uppercase tracking-[0.06em]",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Map diagnosis step status to badge variant. */
export function statusToBadgeVariant(
  status: string,
): BadgeVariant {
  switch (status) {
    case "correct":
      return "success";
    case "error":
      return "error";
    case "suboptimal":
      return "warning";
    case "skipped":
      return "warning";
    case "unclear":
      return "muted";
    default:
      return "info";
  }
}
