import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { apiHealth, getToken, setToken } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  /** Extra paths that should light this item up (one nav slot, several URLs). */
  alsoActiveOn?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// The pages grouped by the operator's job, in the order they're worked:
// MONITOR first (is anything broken?), then CUSTOMERS (who are my users,
// what are they doing), then SYSTEM (internal management). Detail pages
// (school/lead/teacher/submission drill-ins) stay off the rail — they're
// reached by clicking a row, not navigating here.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { to: "/overview", label: "Overview" },
      { to: "/llm-calls", label: "LLM calls" },
      { to: "/grading-quality", label: "Grading quality" },
      { to: "/generation-quality", label: "Generation quality" },
      { to: "/quality", label: "Solution quality" },
      { to: "/harness-runs", label: "Harness runs" },
      { to: "/golden-set", label: "Generation QA" },
    ],
  },
  {
    label: "Customers",
    items: [
      { to: "/schools", label: "Schools" },
      { to: "/leads", label: "Leads" },
      // One slot for both audiences — the page itself toggles between
      // them. Both URLs stay live; signup alert emails link to each.
      { to: "/teachers/independent", label: "Independent users",
        alsoActiveOn: ["/students/independent"] },
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
  const { pathname } = useLocation();
  const [apiDown, setApiDown] = useState(apiHealth.isDown());
  useEffect(() => apiHealth.subscribe(setApiDown), []);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic</div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `nav-link ${
                    isActive || n.alsoActiveOn?.includes(pathname) ? "active" : ""
                  }`
                }
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
