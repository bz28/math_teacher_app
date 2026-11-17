import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  // UUIDs only: a hand-typed /schools/foo must not become a stored scope
  // that scopes every page to nothing.
  return m && UUID_RE.test(m[1]) ? m[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (school.id === null) {
    return (
      <div className="scope-line" role="note">
        <span className="scope-line-label">Scope</span>
        <span><b>All schools</b> — every school combined, plus activity that belongs to no school.</span>
      </div>
    );
  }
  // A school IS being sent. Say so even when the list can't name it (the
  // schools fetch failed, or this school isn't in it) — claiming All
  // schools here would misdescribe every number below — and always keep
  // the way out, since the switcher can't render without the list.
  const picked = school.schools.find((s) => s.id === school.id);
  return (
    <div className="scope-line scope-line-school" role="note">
      <span className="scope-line-label">Scope</span>
      {picked
        ? <span><b>{schoolLabel(picked)}</b> only</span>
        : <span><b>Selected school</b> only (school list unavailable)</span>}
      <button type="button" className="link-btn scope-line-clear" onClick={() => setSchoolScope(null)}>
        Show all schools
      </button>
    </div>
  );
}

/** A school named in a scoped page's URL — `?school=` (LLM calls' old
 *  deep links) or `?school_id=` (Audit log's) — or null. UUIDs only, so
 *  a mangled link can't scope every page to nothing. */
function urlSchoolParam(params: URLSearchParams): string | null {
  const v = params.get("school") ?? params.get("school_id");
  return v && UUID_RE.test(v) ? v : null;
}

export default function Layout() {
  // Mirror the global API-health flag onto a rail-foot status dot so the
  // operator always sees at a glance whether the backend is reachable.
  const [apiDown, setApiDown] = useState(apiHealth.isDown());
  useEffect(() => apiHealth.subscribe(setApiDown), []);

  const school = useSelectedSchool();

  // Opening a school's page — from the Schools directory, a breadcrumb, a
  // shared link — is choosing that school, so the scope follows the URL.
  // Straight from the route, NOT gated on the schools list: if that fetch
  // fails, the page's own "this school's calls" links must still land on
  // this school rather than whatever was saved before. (An id the list
  // later proves unknown is reset to All schools by useSelectedSchool;
  // this effect only re-runs when the route changes, so the two can't
  // ping-pong.)
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const routeId = routeSchoolId(pathname);
  useEffect(() => {
    if (routeId) setSchoolScope(routeId);
  }, [routeId]);

  // A shared link that names a school (`/llm-calls?school=…`,
  // `/audit-logs?school_id=…`) sets the scope, then drops the param so
  // the URL and the rail can't disagree later.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const fromUrl = urlSchoolParam(params);
    if (!fromUrl || pageScope(pathname, search) !== "school") return;
    setSchoolScope(fromUrl);
    params.delete("school");
    params.delete("school_id");
    navigate({ pathname, search: params.toString() }, { replace: true });
  }, [pathname, search, navigate]);

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
        {/* The page remounts when the scope changes, so nothing local to
            the old school survives the switch — a page offset past the
            end of the new list, an open drill-in on the old school's row.
            Keyed on the scope ALONE, never on the page's kind: a URL that
            changes kind on the same route (LLM calls gaining ?user=, Users
            flipping to the Admins preset) must not wipe its local filters. */}
        <Outlet key={`scope:${school.id ?? "all"}`} />
      </main>
    </div>
  );
}
