import Link from "next/link";
import { breadcrumbTrail, type Crumb } from "./breadcrumb-trail";

export type { Crumb };

/**
 * Where a deep page sits: course › homework › section, each a link back
 * up but the last, which is the page you're on. Replaces the single
 * "← Back to …" link, which only knew one step up. Which crumbs show is
 * breadcrumbTrail's; the bar keeps its height while names load so the
 * page doesn't jump when they arrive.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const shown = breadcrumbTrail(items);
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-h-4 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted">
        {shown.map((c, i) => {
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-x-1.5">
              {i > 0 && (
                <span aria-hidden className="text-text-muted/70">
                  ›
                </span>
              )}
              {!c.href ? (
                <span
                  aria-current={c.current ? "page" : undefined}
                  className={`max-w-[24rem] truncate ${c.current ? "font-semibold text-text-secondary" : ""}`}
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="max-w-[16rem] truncate font-medium transition-colors hover:text-primary"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
