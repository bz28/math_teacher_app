import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
}

// Two groups in the sidebar — audiences first (the three scopes you
// run the business through, plus the Leads funnel that feeds them),
// then a divider, then the engineer-facing diagnostic tools below.
const AUDIENCE_NAV: NavItem[] = [
  { to: "/leads", label: "Leads" },
  { to: "/schools", label: "Schools" },
  { to: "/students/independent", label: "Independent students" },
  { to: "/teachers/independent", label: "Independent teachers" },
  { to: "/admins", label: "Admins" },
];

const DIAGNOSTIC_NAV: NavItem[] = [
  { to: "/llm-calls", label: "LLM calls" },
  { to: "/quality", label: "Quality" },
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
