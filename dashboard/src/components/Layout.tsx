import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";
import { useScope } from "../lib/scope";
import ScopePicker from "./ScopePicker";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

// Cross-school god-view. Schools and Leads only show here — they're
// noise inside a single school's scope.
const ADMIN_NAV: NavItem[] = [
  { to: "/admin/overview", label: "Overview", icon: "📊" },
  { to: "/admin/llm-calls", label: "LLM Calls", icon: "🤖" },
  { to: "/admin/users", label: "Users", icon: "👥" },
  { to: "/admin/quality", label: "Quality", icon: "✅" },
  { to: "/admin/promo-codes", label: "Promo Codes", icon: "🎟️" },
  { to: "/admin/schools", label: "Schools", icon: "🏫" },
  { to: "/admin/leads", label: "Leads", icon: "📩" },
];

function buildSchoolNav(schoolId: string): NavItem[] {
  // Per-school nav — Overview lands first; everything else is the
  // scoped slice of the same data the admin can see globally. Real
  // metric pages (per-class, per-teacher, etc.) ship in PR D.
  return [
    { to: `/school/${schoolId}/overview`, label: "Overview", icon: "📊" },
    { to: `/school/${schoolId}/llm-calls`, label: "LLM Calls", icon: "🤖" },
  ];
}

export default function Layout() {
  const { scope } = useScope();
  const nav =
    scope.kind === "admin" ? ADMIN_NAV : buildSchoolNav(scope.schoolId);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">Veradic AI</div>
          <div className="sidebar-brand-sub">Admin Dashboard</div>
        </div>
        <ScopePicker />
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            end={n.to === "/admin/overview"}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
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
