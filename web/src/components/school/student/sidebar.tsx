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
 * Left-rail nav for the school-student portal.
 *
 * Shape:
 * - Desktop (md+): `Sidebar` renders a persistent sticky aside.
 * - Mobile (<md): `MobileSidebarDrawer` renders the same content
 *   inside a slide-out drawer toggled by the layout's hamburger.
 *
 * Both share `SidebarContent` so the class list, join modal, nav
 * items, and account footer stay in one place.
 */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border-light bg-surface md:flex">
      <SidebarContent />
    </aside>
  );
}

export function MobileSidebarDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Close on ESC + trap body scroll while open. Same ergonomic
  // floor as SidebarJoinModal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative flex h-full w-64 max-w-[80%] flex-col border-r border-border-light bg-surface shadow-xl">
        <SidebarContent onNavigate={onClose} />
      </aside>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void } = {}) {
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

  // Wrap Link click handlers so the mobile drawer auto-closes after
  // navigation. Desktop passes no onNavigate → noop.
  const afterNav = () => onNavigate?.();

  return (
    <>
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
          onClick={afterNav}
        />
        <NavLink
          href="/school/student/grades"
          label="My Grades"
          active={pathname.startsWith("/school/student/grades")}
          icon={<GradesIcon />}
          onClick={afterNav}
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
                onClick={afterNav}
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
          onClick={afterNav}
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
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
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
