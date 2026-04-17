"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { schoolStudent, type StudentClassSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/shared/logo-mark";
import { SidebarJoinModal } from "./sidebar-join-modal";

/**
 * Left-rail nav for the school-student portal. Always visible on md+;
 * mobile experience is handled by the layout wrapper.
 *
 * Owns the classes list for the "My Classes" section so a single
 * fetch covers both the sidebar AND avoids the old dashboard's
 * redundant class fetch.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [classes, setClasses] = useState<StudentClassSummary[] | null>(null);
  const [showJoin, setShowJoin] = useState(false);

  const loadClasses = () => {
    schoolStudent
      .listClasses()
      .then(setClasses)
      .catch(() => setClasses([]));
  };

  useEffect(() => {
    loadClasses();
  }, []);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border-light bg-surface md:flex">
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 border-b border-border-light px-5">
          <LogoMark size={32} />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-text-primary">
              Veradic AI
            </div>
            <div className="truncate text-[11px] font-medium text-text-muted">
              {user?.school_name || "Student"}
            </div>
          </div>
        </div>

        {/* Primary nav — Dashboard matches only the exact root so a
            /school/student/grades route doesn't highlight both rows. */}
        <nav className="space-y-0.5 px-3 py-4">
          <NavLink
            href="/school/student"
            label="Dashboard"
            active={pathname === "/school/student"}
            icon={<DashboardIcon />}
          />
          <NavLink
            href="/school/student/grades"
            label="My Grades"
            active={pathname.startsWith("/school/student/grades")}
            icon={<GradesIcon />}
          />
        </nav>

        {/* Classes */}
        <div className="flex min-h-0 flex-1 flex-col px-3">
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              My Classes
            </span>
            <button
              type="button"
              onClick={() => setShowJoin(true)}
              title="Join a class"
              className="-mr-1 flex h-6 w-6 items-center justify-center rounded-[--radius-sm] text-text-muted transition-colors hover:bg-primary-bg/50 hover:text-primary"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="-mr-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
            {classes === null && (
              <div className="px-3 py-2 text-xs text-text-muted">Loading…</div>
            )}
            {classes?.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">
                Tap + to join
              </div>
            )}
            {classes?.map((c) => {
              const href = `/school/student/courses/${c.course_id}`;
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={c.section_id}
                  href={href}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-[--radius-sm] px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary-bg text-primary"
                      : "text-text-secondary hover:bg-primary-bg/50 hover:text-primary",
                  )}
                >
                  <span className="truncate font-semibold">{c.course_name}</span>
                  <span className="truncate text-[11px] font-medium text-text-muted">
                    {c.section_name}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Bottom — account + logout */}
        <div className="border-t border-border-light px-3 py-3">
          <Link
            href="/account"
            className={cn(
              "flex items-center gap-3 rounded-[--radius-sm] px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith("/account")
                ? "bg-primary-bg text-primary"
                : "text-text-secondary hover:bg-primary-bg/50 hover:text-primary",
            )}
          >
            <AccountIcon />
            Account
          </Link>
          <div className="mt-1 flex items-center justify-between px-3">
            <span className="truncate text-xs font-medium text-text-muted">
              {user?.name}
            </span>
            <button
              onClick={logout}
              className="rounded-[--radius-sm] p-1.5 text-text-muted transition-colors hover:bg-error-light hover:text-error"
              title="Sign out"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      <SidebarJoinModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onJoined={loadClasses}
      />
    </>
  );
}

function NavLink({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-[--radius-sm] px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary-bg text-primary"
          : "text-text-secondary hover:bg-primary-bg/50 hover:text-primary",
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function DashboardIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function GradesIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2h6a2 2 0 012 2v16a2 2 0 01-2 2H9a2 2 0 01-2-2V4a2 2 0 012-2z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
