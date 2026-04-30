import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import {
  ScopeContext,
  parseScopeFromPath,
  type SchoolOption,
  type ScopeContextValue,
} from "./scope-context";

// The dashboard runs in one of two scopes at any time. Admin = the
// god-view (every school + leads + cross-platform stuff + the
// "internal" pseudo-school of non-school users). School = scoped to
// one school (or to school_id IS NULL if the special "internal"
// entry is picked).
//
// The scope is derived from the URL (`/admin/...` or
// `/school/:id/...`) so it survives reload, deep-links, and shares.
//
// Types, constants, the context object, and the useScope hook live
// in scope-context.ts so this file (a .tsx) only exports the
// ScopeProvider component — keeps react-refresh happy.

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
