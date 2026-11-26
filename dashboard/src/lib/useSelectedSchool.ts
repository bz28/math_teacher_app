import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, type SchoolListItem } from "./api";

/**
 * Which school the console is scoped to — or `null` for All schools.
 *
 * This is the console's scope. Every page whose data belongs to schools
 * (the accuracy pages, Teacher reports, LLM calls, Users,
 * Audit log) reads it and sends it as `school_id`; the backend filters on
 * it. Pages whose data belongs to no school (Schools directory, Leads,
 * Evals, Harness) ignore it, and the rail's scope line says so.
 *
 * `null` means All schools: the endpoints are called with no `school_id`,
 * so they answer exactly as they did before the switcher scoped anything
 * — every row, counted once. That is the default for an operator who has
 * never picked a school.
 *
 * A module-level external store rather than React context because the
 * writers (the switcher, a school page, a teacher page) and the readers
 * (every page) have no common parent below the router; it is the same
 * `useSyncExternalStore` pattern `apiHealth` uses. The choice persists
 * in localStorage so a reload keeps the operator where they were.
 */

// A NEW key, deliberately. The previous one ("veradic_admin_school")
// was written every time an operator opened any school, teacher or
// student page, back when the value only steered one rail link. Read as
// a scope it would open nearly every existing operator's console
// narrowed to whichever school they last brushed past — the opposite of
// the All-schools default. So the old value is discarded, not migrated.
const STORAGE_KEY = "veradic_admin_scope";
const RETIRED_KEY = "veradic_admin_school";

function readStored(): string | null {
  try {
    localStorage.removeItem(RETIRED_KEY);
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode / storage disabled — All schools
  }
}

let scope: string | null = readStored();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(): string | null {
  return scope;
}

/** Set the scope. `null` = All schools. Persisted. */
export function setSchoolScope(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal: the scope still applies, it just won't survive a reload.
  }
  if (scope === id) return;
  scope = id;
  listeners.forEach((fn) => fn());
}

/** The current scope: a school id, or `null` for All schools. */
export function useSchoolScope(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The query params that carry the scope. Empty for All schools. */
export function scopeParams(schoolId: string | null): Record<string, string> {
  return schoolId ? { school_id: schoolId } : {};
}

/**
 * A page showing one entity that belongs to a school (a teacher, a
 * student) keeps the rail honest: if the scope names a DIFFERENT school,
 * the scope follows the page. Under All schools it is left alone — the
 * entity is already inside "all", and silently collapsing the scope to
 * one school just because an operator opened a teacher would quietly
 * narrow every page they visit next.
 */
export function useScopeToSchool(schoolId: string | null | undefined): void {
  useEffect(() => {
    if (schoolId && scope !== null && scope !== schoolId) setSchoolScope(schoolId);
  }, [schoolId]);
}

export interface SelectedSchool {
  /** The scoped school, or null for All schools. */
  id: string | null;
  /** Its name, or null for All schools / a school not in the list. */
  name: string | null;
  schools: SchoolListItem[];
  loading: boolean;
}

export function useSelectedSchool(): SelectedSchool {
  const id = useSchoolScope();
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

  // A remembered school that no longer exists (deleted since) would scope
  // every page to nothing, with a switcher that can't display it. Fall
  // back to All schools once the list proves it's gone. Only on a
  // successful, non-empty load — a failed fetch proves nothing.
  //
  // "Proves" means a list fetched AFTER the id was chosen. The list is
  // loaded once per session, so a school created since (Add school, or
  // converting a lead) is missing from it while being perfectly real —
  // opening it would otherwise be undone straight away. So a missing id
  // first refetches the list, and only a miss in a list fetched after that
  // id was chosen resets.
  //
  // `recheckedFor` is marked only when a fresh list has actually been
  // APPLIED. A refetch that fails proves nothing and leaves it unmarked,
  // so the next visit tries again; one that resolves after the operator
  // has already moved on is still applied — a newer list is a better list
  // whoever asked for it — rather than dropped, which used to leave the id
  // marked as checked against a list that never arrived.
  const recheckedFor = useRef<string | null>(null);
  const inFlightFor = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    // Set on mount too: StrictMode mounts, unmounts and remounts.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!schools || schools.length === 0 || !id || schools.some((s) => s.id === id)) return;
    if (recheckedFor.current === id) {
      setSchoolScope(null);
      return;
    }
    if (inFlightFor.current === id) return;
    inFlightFor.current = id;
    api
      .schools()
      .then((r) => {
        if (!mounted.current) return;
        recheckedFor.current = id;
        setSchools(r.schools);
      })
      // A failed refetch proves nothing either: keep the scope. The
      // strip still names it and offers "Show all schools".
      .catch(() => {})
      .finally(() => {
        if (inFlightFor.current === id) inFlightFor.current = null;
      });
  }, [schools, id]);

  return useMemo(
    () => ({
      id,
      name: schools?.find((s) => s.id === id)?.name ?? null,
      schools: schools ?? [],
      loading: schools === null,
    }),
    [id, schools],
  );
}
