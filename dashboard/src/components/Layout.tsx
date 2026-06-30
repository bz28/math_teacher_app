import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
}

// Three groups in the sidebar — audiences first (the scopes you run
// the business through, plus the Leads funnel that feeds them), then
// the diagnostic tools, then a final internal group for operator
// management. Admins are internal teammates, not an audience.
const AUDIENCE_NAV: NavItem[] = [
  { to: "/leads", label: "Leads" },
  { to: "/schools", label: "Schools" },
  { to: "/students/independent", label: "Independent students" },
  { to: "/teachers/independent", label: "Independent teachers" },
];

const DIAGNOSTIC_NAV: NavItem[] = [
  { to: "/audit-logs", label: "Audit logs" },
  { to: "/llm-calls", label: "LLM calls" },
  { to: "/harness-runs", label: "Harness runs" },
  { to: "/quality", label: "Solution quality" },
  { to: "/grading-quality", label: "Grading quality" },
  { to: "/demo", label: "The pitch" },
  { to: "/golden-set", label: "Golden set" },
  { to: "/golden-set/integrity", label: "Integrity set" },
  { to: "/golden-set/grading", label: "Grading set" },
  { to: "/golden-set/generation", label: "Generation set" },
  { to: "/golden-set/teacher-day", label: "Teacher's day" },
];

const INTERNAL_NAV: NavItem[] = [
  { to: "/admins", label: "Admins" },
];

export default function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic</div>
          <div className="sidebar-brand-sub">Operations</div>
        </div>

        {AUDIENCE_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            {n.label}
          </NavLink>
        ))}

        <div className="nav-divider" />

        {DIAGNOSTIC_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            {n.label}
          </NavLink>
        ))}

        <div className="nav-divider" />

        {INTERNAL_NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            {n.label}
          </NavLink>
        ))}

        {getToken() && (
          <button
            className="logout-btn"
            style={{ marginTop: "auto" }}
            onClick={() => { setToken(null); window.location.href = "/login"; }}
          >
            Sign out
          </button>
        )}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
