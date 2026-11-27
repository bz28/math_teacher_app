/** `fallback` names a crumb whose label may never arrive (the course's,
 *  read from a list that can fail): it then shows as that word rather
 *  than vanishing, so the page keeps its link up. */
export type Crumb = { label: string; href?: string; fallback?: string };
export type ShownCrumb = { label: string; href: string | null; current: boolean };

/**
 * The crumbs to draw. The last item is the page you're on; every other
 * crumb with an href is a link up. A crumb whose label hasn't loaded yet
 * (or never will, on an error) is left out — and when that's the current
 * page's, the crumb before it stays a link, since it's still the way back.
 */
export function breadcrumbTrail(items: Crumb[]): ShownCrumb[] {
  const lastIdx = items.length - 1;
  return items.flatMap((c, i) => {
    const label = c.label || c.fallback;
    return label
      ? [{ label, href: i === lastIdx ? null : (c.href ?? null), current: i === lastIdx }]
      : [];
  });
}
