import Link from "next/link";

export type Crumb = { label: string; href?: string };

/**
 * Where a deep page sits: course › homework › section, each a link back
 * up but the last, which is the page you're on. Replaces the single
 * "← Back to …" link, which only knew one step up. A crumb whose label
 * hasn't loaded yet is left out rather than shown blank; the bar keeps
 * its height meanwhile so the page doesn't jump when the names arrive.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const shown = items.filter((c) => c.label);
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-h-4 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted">
        {shown.map((c, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-x-1.5">
              {i > 0 && (
                <span aria-hidden className="text-text-muted/70">
                  ›
                </span>
              )}
              {last || !c.href ? (
                <span
                  aria-current={last ? "page" : undefined}
                  className={`max-w-[24rem] truncate ${last ? "font-semibold text-text-secondary" : ""}`}
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
