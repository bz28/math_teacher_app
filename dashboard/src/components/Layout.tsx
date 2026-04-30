import { NavLink, Outlet } from "react-router-dom";
import { getToken, setToken } from "../lib/api";
import { INTERNAL_SCHOOL_ID, useScope } from "../lib/scope";
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
  const { scope, schools } = useScope();
  const nav =
    scope.kind === "admin" ? ADMIN_NAV : buildSchoolNav(scope.schoolId);

  // Top-of-content scope chip so the user can see which world they
  // are in without having to read the small picker label. The chip
  // matches the dropdown's vocabulary so the two surfaces reinforce.
  let scopeChipLabel: string;
  let scopeChipKind: "admin" | "internal" | "school";
  if (scope.kind === "admin") {
    scopeChipLabel = "Admin (everything)";
    scopeChipKind = "admin";
  } else if (scope.schoolId === INTERNAL_SCHOOL_ID) {
    scopeChipLabel = "Internal · no-school";
    scopeChipKind = "internal";
  } else {
    const name = schools.find((s) => s.id === scope.schoolId)?.name;
    scopeChipLabel = name ? `School · ${name}` : "School";
    scopeChipKind = "school";
  }

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
        <div className={`scope-banner scope-banner-${scopeChipKind}`}>
          <span className="scope-banner-eyebrow">Scope</span>
          <span className="scope-banner-value">{scopeChipLabel}</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
