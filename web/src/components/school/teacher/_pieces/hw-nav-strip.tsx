"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Section-link strip rendered at the top of every HW detail page.
 * Links to sibling URL-suffix routes (Problems, Practice, Review).
 * The Review link is optional — only shown when the HW is published
 * (drafts have nothing to grade yet).
 *
 * URL-suffix architecture: each section is its own page with its own
 * data fetch. No shared state between sections, no tab state to
 * manage. Deep-linking works for free.
 */
export function HwNavStrip({
  courseId,
  assignmentId,
  reviewEnabled,
  pendingCount,
}: {
  courseId: string;
  assignmentId: string;
  /** Show the Review link only when it points somewhere meaningful
   *  (published HW with submissions). Hidden on drafts. */
  reviewEnabled: boolean;
  /** Optional badge on the Practice link showing how many variations
   *  are waiting for review. Omit or pass 0 to hide. */
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const base = `/school/teacher/courses/${courseId}/homework/${assignmentId}`;

  const items: {
    label: string;
    href: string;
    badge?: number;
  }[] = [
    { label: "Problems", href: base },
    { label: "Practice", href: `${base}/practice`, badge: pendingCount },
  ];
  if (reviewEnabled) {
    items.push({ label: "Review", href: `${base}/review` });
  }

  return (
    <nav
      aria-label="Homework sections"
      className="mt-3 flex items-center gap-1 border-b border-border-light"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href, base);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:border-border-light hover:text-text-primary",
            )}
          >
            {item.label}
            {item.badge && item.badge > 0 ? (
              <span
                aria-label={`${item.badge} pending`}
                className={cn(
                  "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                  active
                    ? "bg-primary text-white"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function isActive(pathname: string, href: string, base: string): boolean {
  // Problems tab = base URL. Active when the pathname exactly equals
  // base (no suffix).
  if (href === base) return pathname === base;
  return pathname === href || pathname.startsWith(`${href}/`);
}
