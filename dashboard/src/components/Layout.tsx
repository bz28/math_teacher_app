import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";

const NAV = [
  { to: "/", label: "Overview", icon: "📊" },
  { to: "/llm-calls", label: "LLM Calls", icon: "🤖" },
  { to: "/users", label: "Users", icon: "👥" },
  { to: "/quality", label: "Quality", icon: "✅" },
];

export default function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Math Tutor</div>
          <div className="sidebar-brand-sub">Admin Dashboard</div>
        </div>
        {NAV.map((n) => (
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
        {getToken() && (
          <button
            className="logout-btn"
            onClick={() => {
              setToken(null);
              window.location.href = "/login";
            }}
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
