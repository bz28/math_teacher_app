import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";

// The dashboard runs in one of two scopes at any time. Admin = the
// god-view (every school + leads + cross-platform stuff + the
// "internal" pseudo-school of non-school users). School = scoped to
// one school (or to school_id IS NULL if the special "internal"
// entry is picked).
//
// The scope is derived from the URL (`/admin/...` or
// `/school/:id/...`) so it survives reload, deep-links, and shares.

export type Scope =
  | { kind: "admin" }
  | { kind: "school"; schoolId: string };

export const INTERNAL_SCHOOL_ID = "internal";

export interface SchoolOption {
  id: string;
  name: string;
}

interface ScopeContextValue {
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

const ScopeContext = createContext<ScopeContextValue | null>(null);

function parseScopeFromPath(pathname: string): Scope {
  // Match /school/<id>/... where id can be a UUID or the special
  // "internal" sentinel for the school_id IS NULL bucket.
  const m = pathname.match(/^\/school\/([^/]+)/);
  if (m) {
    return { kind: "school", schoolId: m[1] };
  }
  return { kind: "admin" };
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolOption[]>([]);

  const scope = useMemo(
    () => parseScopeFromPath(location.pathname),
    [location.pathname],
  );

  // Load the schools list once for the picker dropdown. Cheap query
  // (no per-row aggregates) and rarely changes; refetched on mount.
  useEffect(() => {
    let cancelled = false;
    api.schools()
      .then((data) => {
        if (cancelled) return;
        setSchools(
          data.schools.map((s) => ({ id: s.id, name: s.name })),
        );
      })
      .catch(() => {
        // Non-fatal — the picker just renders without real schools
        // until the next reload. Admin scope still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enterAdmin = useCallback(() => {
    navigate("/admin/overview");
  }, [navigate]);

  const enterSchool = useCallback((schoolId: string) => {
    navigate(`/school/${schoolId}/overview`);
  }, [navigate]);

  const apiSchoolFilter = useCallback(() => {
    if (scope.kind === "admin") return undefined;
    return scope.schoolId;
  }, [scope]);

  const value = useMemo<ScopeContextValue>(
    () => ({ scope, schools, enterAdmin, enterSchool, apiSchoolFilter }),
    [scope, schools, enterAdmin, enterSchool, apiSchoolFilter],
  );

  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}

export function useScope(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("useScope must be used inside a ScopeProvider");
  }
  return ctx;
}
