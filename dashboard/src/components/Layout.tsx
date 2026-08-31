import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { apiHealth, getToken, setToken } from "../lib/api";
import SchoolSwitcher from "./SchoolSwitcher";
import { useSelectedSchool } from "../lib/useSelectedSchool";

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

/** Pages scoped to the selected school. The daily work starts here. */
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
];

/**
 * Tier two: real, reachable, and quiet. Business and platform plumbing —
 * consulted, not worked in.
 */
const SECONDARY: NavItem[] = [
  { to: "/overview", label: "Platform health" },
  { to: "/schools", label: "Schools", end: true },
  { to: "/leads", label: "Leads" },
  { to: "/teachers/independent", label: "Independent teachers" },
  { to: "/students/independent", label: "Independent students" },
  { to: "/llm-calls", label: "LLM calls & spend" },
  { to: "/users", label: "Users" },
  { to: "/audit-logs", label: "Audit log" },
];

export default function Layout() {
  // Mirror the global API-health flag onto a rail-foot status dot so the
  // operator always sees at a glance whether the backend is reachable.
  const [apiDown, setApiDown] = useState(apiHealth.isDown());
  useEffect(() => apiHealth.subscribe(setApiDown), []);

  const school = useSelectedSchool();

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
        <Outlet />
      </main>
    </div>
  );
}
