import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

/**
 * The scope, as an external store.
 *
 * A page that shows something belonging to a school — a teacher, say —
 * publishes that school here, and the rail follows. Without it the rail
 * asserted whatever it last remembered: open a Riverside teacher from a
 * platform-wide list and the switcher still said "Holy Ghost Prep",
 * directly contradicting the breadcrumb an inch away. Two school names on
 * one screen meaning different things is the confusion this whole
 * restructure exists to remove.
 *
 * An external store rather than state-in-a-parent because the publisher
 * (a deep page) and the reader (the rail) have no component relationship;
 * `useSyncExternalStore` is the same pattern `apiHealth` already uses.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): string | null {
  return current;
}

export function rememberSchool(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal: the switcher still works, it just won't persist.
  }
  if (current === id) return;
  current = id;
  listeners.forEach((fn) => fn());
}

/**
 * Publish the school a non-school-scoped page is showing, so the rail
 * agrees with the page. Call it from an effect, not during render.
 */
export function useScopeToSchool(schoolId: string | null | undefined): void {
  useEffect(() => {
    if (schoolId) rememberSchool(schoolId);
  }, [schoolId]);
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
  const published = useSyncExternalStore(subscribe, snapshot, snapshot);
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
    // The URL wins UNCONDITIONALLY when there is one, even if the school
    // isn't in the switcher's list. `api.schools()` returns only
    // institutional schools, while GET /schools/{id} has no such filter —
    // so an indie teacher's synthetic school (reachable from a submission
    // trace) renders a page the list has never heard of. Falling through
    // there would leave the rail confidently naming a DIFFERENT school
    // than the page is showing, which is the one outcome this ordering
    // exists to prevent.
    if (routeId) return routeId;
    // What the current page says it is showing beats anything remembered.
    if (published) return published;
    if (!schools || schools.length === 0) return null;
    const saved = remembered();
    if (saved && schools.some((s) => s.id === saved)) return saved;
    return schools[0].id;
  }, [schools, routeId, published]);

  return {
    id,
    name: schools?.find((s) => s.id === id)?.name ?? null,
    schools: schools ?? [],
    loading: schools === null,
  };
}
