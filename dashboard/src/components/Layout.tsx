import { NavLink, Outlet } from "react-router-dom";
import { getToken, getUserRole, setToken } from "../lib/api";

const ADMIN_NAV = [
  { to: "/", label: "Overview", icon: "📊" },
  { to: "/llm-calls", label: "LLM Calls", icon: "🤖" },
  { to: "/users", label: "Users", icon: "👥" },
  { to: "/quality", label: "Quality", icon: "✅" },
  { to: "/promo-codes", label: "Promo Codes", icon: "🎟️" },
];

const TEACHER_NAV = [
  { to: "/courses", label: "Courses", icon: "📚" },
  { to: "/homework", label: "Homework", icon: "📝" },
  { to: "/tests", label: "Tests", icon: "🧪" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
];

export default function Layout() {
  const role = getUserRole();
  const isAdmin = role === "admin";
  const nav = isAdmin ? ADMIN_NAV : TEACHER_NAV;
  const subtitle = isAdmin ? "Admin Dashboard" : "Teacher Dashboard";

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic AI</div>
          <div className="sidebar-brand-sub">{subtitle}</div>
        </div>
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            end={n.to === "/"}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        {isAdmin && (
          <>
            <div className="nav-divider" />
            {TEACHER_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} end>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </>
        )}
        {getToken() && (
          <button
            className="logout-btn"
            onClick={() => { setToken(null); window.location.href = "/login"; }}
          >
            Logout
          </button>
        )}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
