import { createContext, useContext } from "react";

// Non-component exports for the scope system. Lives in a `.ts` file
// (no JSX) so it can hold types/constants/hooks without tripping
// `react-refresh/only-export-components` — which fires when a `.tsx`
// file mixes component and non-component exports. The actual
// ScopeProvider component lives in scope.tsx and reads from here.

export type Scope =
  | { kind: "admin" }
  | { kind: "school"; schoolId: string };

export const INTERNAL_SCHOOL_ID = "internal";

export interface SchoolOption {
  id: string;
  name: string;
}

export interface ScopeContextValue {
  scope: Scope;
  schools: SchoolOption[];
  /** Switch to the Admin scope at /admin/... */
  enterAdmin: () => void;
  /** Switch to a specific school's scope at /school/:id/... */
  enterSchool: (schoolId: string) => void;
  /**
   * The school_id query param value to send to the backend for the
   * current scope. Returns:
   *  - undefined for Admin (no filter; show everything)
   *  - the school UUID for a real school
   *  - the literal "internal" sentinel for school_id IS NULL
   */
  apiSchoolFilter: () => string | undefined;
}

export const ScopeContext = createContext<ScopeContextValue | null>(null);

export function parseScopeFromPath(pathname: string): Scope {
  // Match /school/<id>/... where id can be a UUID or the special
  // "internal" sentinel for the school_id IS NULL bucket.
  const m = pathname.match(/^\/school\/([^/]+)/);
  if (m) {
    return { kind: "school", schoolId: m[1] };
  }
  return { kind: "admin" };
}

export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("useScope must be used inside a ScopeProvider");
  }
  return ctx;
}
