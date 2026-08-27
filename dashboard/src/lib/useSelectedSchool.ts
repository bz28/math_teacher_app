import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, type SchoolListItem } from "./api";

/**
 * Which school the console is scoped to.
 *
 * Everything under "This school" in the rail is scoped by this, so a
 * school stops being a place you navigate *to* and becomes the context you
 * work *inside*. That removes a click from the journey that matters most:
 * with one customer, "Schools" is a list of one, and walking a list to
 * reach its only row conveys nothing.
 *
 * Selection resolves in this order, and the order is the point:
 *
 *   1. the school in the URL, when there is one — a shared or bookmarked
 *      link must beat anything remembered locally, or the rail would claim
 *      a different school than the page is showing;
 *   2. the last school this operator chose (localStorage);
 *   3. the first school in the list.
 */

const STORAGE_KEY = "veradic_admin_school";

export function rememberSchool(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal: the switcher still works, it just won't persist.
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled — fall through to first
  }
}

/**
 * The school id in the URL, or null.
 *
 * Read off the pathname rather than useParams: this runs inside the
 * LAYOUT, and a layout's useParams only sees params matched by its own
 * route and its ancestors — `:schoolId` belongs to a descendant route, so
 * it would always come back undefined here.
 */
function routeSchoolId(pathname: string): string | null {
  const m = /^\/schools\/([^/?#]+)/.exec(pathname);
  return m ? m[1] : null;
}

export interface SelectedSchool {
  id: string | null;
  name: string | null;
  schools: SchoolListItem[];
  loading: boolean;
}

export function useSelectedSchool(): SelectedSchool {
  const { pathname } = useLocation();
  const routeId = routeSchoolId(pathname);
  const [schools, setSchools] = useState<SchoolListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .schools()
      .then((r) => {
        if (!cancelled) setSchools(r.schools);
      })
      .catch(() => {
        // The switcher is chrome, not content. A failed load leaves it
        // hidden rather than throwing an error banner over every page.
        if (!cancelled) setSchools([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const id = useMemo(() => {
    if (!schools || schools.length === 0) return null;
    // A URL only wins if it names a school we actually have, so a stale
    // link to a deleted school falls through instead of selecting nothing.
    if (routeId && schools.some((s) => s.id === routeId)) return routeId;
    const saved = remembered();
    if (saved && schools.some((s) => s.id === saved)) return saved;
    return schools[0].id;
  }, [schools, routeId]);

  return {
    id,
    name: schools?.find((s) => s.id === id)?.name ?? null,
    schools: schools ?? [],
    loading: schools === null,
  };
}
