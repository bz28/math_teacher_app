import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/llm-calls", label: "LLM Calls" },
  { to: "/quality", label: "Quality" },
  { to: "/sessions", label: "Sessions" },
  { to: "/users", label: "Users" },
];

export default function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <h2 style={{ margin: "0 0 24px", fontSize: 18 }}>Math Teacher Admin</h2>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            end={n.to === "/"}
          >
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
