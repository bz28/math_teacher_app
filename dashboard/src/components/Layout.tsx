import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { apiHealth, getToken, setToken } from "../lib/api";
import SchoolSwitcher from "./SchoolSwitcher";
import { setSchoolScope, useSelectedSchool, type SelectedSchool } from "../lib/useSelectedSchool";
import { pageScope, schoolLabel } from "../lib/pageScope";

interface NavItem {
  to: string;
  label: string;
  /** Match the path exactly, not as a prefix. */
  end?: boolean;
}

// The rail is a HIERARCHY, not a list of equals.
//
// This console has one job that gets done daily — inspect what the system
// actually did for a real teacher, and judge whether the AI's output was
// any good — and a long tail of things consulted occasionally. Giving all
// eleven destinations the same weight made the daily work compete with
// billing plumbing for the same glance.
//
// So the primary tier is the work; everything else sits below a rule in
// muted type. Nothing is hidden — demoted is not deleted — but the eye
// lands on the two or three things that are actually why you opened this.

/** The selected school's own page. Shown only when one is selected —
 *  under All schools the Schools directory is the way in. */
const SCHOOL_LINKS: { to: (id: string) => string; label: string }[] = [
  // Named for what the page leads with, not "Overview" — a platform
  // Overview also exists, and two identical labels in one rail is a coin
  // toss every time you look for either.
  { to: (id) => `/schools/${id}`, label: "Teachers & classes" },
];

/**
 * Tier one. Deliberately short, and deliberately only things that EXIST:
 * a primary slot pointing at an unbuilt page is worse than no slot. The
 * student-conversation viewer and the rollout-state teacher list join
 * this tier as they land.
 */
const PRIMARY: NavItem[] = [
  { to: "/ai-quality", label: "Quality" },
  { to: "/reports", label: "Teacher reports" },
];

/**
 * Tier two: real, reachable, and quiet. Business and platform plumbing —
 * consulted, not worked in.
 */
const SECONDARY: NavItem[] = [
  { to: "/overview", label: "Platform health" },
  { to: "/schools", label: "Schools", end: true },
  { to: "/leads", label: "Leads" },
  { to: "/llm-calls", label: "LLM calls & spend" },
  { to: "/users", label: "Users" },
  { to: "/audit-logs", label: "Audit log" },
];

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

/**
 * One line above every page saying what it is showing, so a number is
 * never read as one school's when it is everyone's, or the reverse.
 * Single-thing pages (a teacher, a submission) get nothing: their header
 * already names their subject.
 */
function ScopeLine({ school }: { school: SelectedSchool }) {
  const { pathname, search } = useLocation();
  const kind = pageScope(pathname, search);
  if (kind === null || school.loading) return null;

  if (kind === "platform") {
    return (
      <div className="scope-line scope-line-platform" role="note">
        <span className="scope-line-label">Scope</span>
        <span>Platform-wide — this page isn't school data, so the school scope doesn't apply.</span>
      </div>
    );
  }

  const picked = school.schools.find((s) => s.id === school.id);
  if (!picked) {
    return (
      <div className="scope-line" role="note">
        <span className="scope-line-label">Scope</span>
        <span><b>All schools</b> — every school combined, plus activity that belongs to no school.</span>
      </div>
    );
  }
  return (
    <div className="scope-line scope-line-school" role="note">
      <span className="scope-line-label">Scope</span>
      <span><b>{schoolLabel(picked)}</b> only</span>
      <button type="button" className="link-btn scope-line-clear" onClick={() => setSchoolScope(null)}>
        Show all schools
      </button>
    </div>
  );
}

export default function Layout() {
  // Mirror the global API-health flag onto a rail-foot status dot so the
  // operator always sees at a glance whether the backend is reachable.
  const [apiDown, setApiDown] = useState(apiHealth.isDown());
  useEffect(() => apiHealth.subscribe(setApiDown), []);

  const school = useSelectedSchool();

  // Opening a school's page — from the Schools directory, a breadcrumb, a
  // shared link — is choosing that school, so the scope follows the URL.
  // Only for schools the switcher lists, so it can always display the
  // result; any other id would be reset to All schools by
  // useSelectedSchool and the two would fight.
  const { pathname, search } = useLocation();
  const kind = pageScope(pathname, search);
  const routeId = routeSchoolId(pathname);
  const listed = school.schools.some((s) => s.id === routeId);
  useEffect(() => {
    if (routeId && listed) setSchoolScope(routeId);
  }, [routeId, listed]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic</div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>

        <SchoolSwitcher selected={school} />

        {/* ── Tier one — the work ─────────────────────────────────── */}
        <div className="nav-primary">
          {school.id &&
            SCHOOL_LINKS.map((l) => (
              <NavLink
                key={l.label}
                to={l.to(school.id!)}
                end
                className="nav-link nav-link-primary"
              >
                {l.label}
              </NavLink>
            ))}
          {PRIMARY.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `nav-link nav-link-primary ${isActive ? "active" : ""}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>

        {/* ── Tier two — reference ────────────────────────────────── */}
        <div className="nav-secondary">
          {SECONDARY.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {n.label}
            </NavLink>
          ))}
        </div>

        <div className="rail-foot">
          <div className={`rail-status ${apiDown ? "rail-status-down" : "rail-status-ok"}`}>
            <span aria-hidden="true" className="rail-status-dot" />
            {apiDown ? "API unreachable" : "System OK"}
          </div>
          {getToken() && (
            <button
              className="logout-btn"
              style={{ marginTop: 0 }}
              onClick={() => { setToken(null); window.location.href = "/login"; }}
            >
              Sign out
            </button>
          )}
        </div>
      </nav>
      <main className="main-content">
        <ScopeLine school={school} />
        {/* A scoped page remounts when the scope changes, so nothing
            local to the old school survives the switch — a page offset
            past the end of the new list, an open drill-in on the old
            school's row. Every other page keeps a stable key. */}
        <Outlet key={kind === "school" ? `scope:${school.id ?? "all"}` : "page"} />
      </main>
    </div>
  );
}
