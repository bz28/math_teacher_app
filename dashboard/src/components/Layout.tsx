import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { apiHealth, getToken, setToken } from "../lib/api";
import SchoolSwitcher from "./SchoolSwitcher";
import { useSelectedSchool } from "../lib/useSelectedSchool";

interface NavItem {
  to: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped on ONE axis: scope. Previously the three groups each used a
// different one — "Monitor" was a verb, "Customers" an entity, "System" a
// layer — so nothing told you which axis to think along and you learned
// the rail by memory instead of predicting it.
//
// Now: what is scoped to the school you have selected, what is platform-
// wide, and what is the console's own plumbing. Detail pages (lead /
// teacher / submission drill-ins) stay off the rail — they're reached by
// clicking a row, not by navigating here.

/**
 * Pages scoped to the selected school.
 *
 * One entry today, because one is all that exists: SchoolDetail is a
 * single 1,300-line page holding teachers, activity, cost and health. It
 * grows entries as those become real routes — deliberately NOT by
 * splitting that page in the same change that moves the navigation
 * around, which is how a reviewable diff turns into an unreviewable one.
 */
const SCHOOL_LINKS: { to: (id: string) => string; label: string }[] = [
  { to: (id) => `/schools/${id}`, label: "Overview" },
];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Platform",
    items: [
      { to: "/overview", label: "Overview" },
      { to: "/schools", label: "All schools" },
      { to: "/leads", label: "Leads" },
      { to: "/teachers/independent", label: "Independent teachers" },
      { to: "/students/independent", label: "Independent students" },
    ],
  },
  {
    label: "AI quality",
    items: [
      // Five sibling pages collapsed to one. "Generation quality" and
      // "Generation QA" were indistinguishable from the rail, and the URLs
      // never matched the labels (Solution quality lived at /quality,
      // Generation QA at /golden-set). One entry, tabs inside.
      { to: "/ai-quality", label: "AI quality" },
      { to: "/llm-calls", label: "LLM calls" },
    ],
  },
  {
    label: "System",
    items: [
      // Users + Admins consolidated: one role-filtered tab. The Admins
      // preset is reached via the in-page segmented filter (role=admin).
      { to: "/users", label: "Users" },
      { to: "/audit-logs", label: "Audit log" },
    ],
  },
];

export default function Layout() {
  // Mirror the global API-health flag onto a rail-foot status dot so the
  // operator always sees at a glance whether the backend is reachable.
  const [apiDown, setApiDown] = useState(apiHealth.isDown());
  useEffect(() => apiHealth.subscribe(setApiDown), []);

  const school = useSelectedSchool();
  const location = useLocation();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic</div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>

        <SchoolSwitcher selected={school} />

        {school.id && (
          <div>
            <div className="nav-section-label">This school</div>
            {SCHOOL_LINKS.map((l) => {
              const to = l.to(school.id!);
              return (
                <NavLink
                  key={l.label}
                  to={to}
                  end
                  className={`nav-link ${location.pathname === to ? "active" : ""}`}
                >
                  {l.label}
                </NavLink>
              );
            })}
          </div>
        )}

        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                {n.label}
              </NavLink>
            ))}
          </div>
        ))}

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
