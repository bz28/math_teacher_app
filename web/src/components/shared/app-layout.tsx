"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { teacher, enterPreviewMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/shared/logo-mark";

// ── Student nav items ──

const studentNavItems = [
  { label: "Home", href: "/home", icon: HomeIcon },
  { label: "History", href: "/history", icon: HistoryIcon },
  { label: "Account", href: "/account", icon: AccountIcon },
];

// ── Teacher nav items ──

const teacherNavItems = [
  { label: "Courses", href: "/school/teacher", icon: CoursesIcon },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const isTeacher = user?.role === "teacher";

  if (isTeacher) {
    return <TeacherLayout>{children}</TeacherLayout>;
  }
  return <StudentLayout>{children}</StudentLayout>;
}

// ── Student layout (existing top bar + bottom tabs) ──

function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <div className="flex flex-1 flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[--radius-sm] focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
      >
        Skip to main content
      </a>

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border-light bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/home" className="flex items-center gap-2">
              <LogoMark size={28} />
              <span className="text-base font-bold tracking-tight text-text-primary">
                Veradic AI
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {studentNavItems.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary-bg text-primary"
                        : "text-text-secondary hover:bg-primary-bg/50 hover:text-primary",
                    )}
                  >
                    <item.icon active={active} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-medium text-text-secondary sm:block">
              {user?.name}
            </span>
            <button
              onClick={logout}
              className="rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-error-light hover:text-error"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 pb-24 md:pb-8">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-surface/95 backdrop-blur-md md:hidden">
        <div className="flex h-16 items-stretch">
          {studentNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-primary" : "text-text-muted",
                )}
              >
                <item.icon active={active} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </Link>
            );
          })}
          <Link
            href="/learn"
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
              pathname.startsWith("/learn") ? "text-primary" : "text-text-muted",
            )}
          >
            <LearnIcon active={pathname.startsWith("/learn")} />
            <span className="text-[10px] font-semibold">Learn</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}

// ── Teacher layout (sidebar + content) ──

function TeacherLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, loadUser } = useAuthStore();
  const [previewLoading, setPreviewLoading] = useState(false);

  return (
    <div className="flex flex-1">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border-light bg-surface md:flex">
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 border-b border-border-light px-5">
          <LogoMark size={32} />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-text-primary">Veradic AI</div>
            <div className="truncate text-[11px] font-medium text-text-muted">
              {user?.school_name || "Teacher"}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {teacherNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-[--radius-sm] px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary-bg text-primary"
                    : "text-text-secondary hover:bg-primary-bg/50 hover:text-primary",
                )}
              >
                <item.icon active={active} />
                {item.label}
              </Link>
            );
          })}

          <div className="my-3 border-t border-border-light" />

          <button
            onClick={async () => {
              if (previewLoading) return;
              setPreviewLoading(true);
              try {
                const tokens = await teacher.previewAsStudent();
                enterPreviewMode(tokens);
                await loadUser();
                router.push("/school/student");
              } catch {
                // Silently fail — teacher stays where they are
              } finally {
                setPreviewLoading(false);
              }
            }}
            disabled={previewLoading}
            className="flex w-full items-center gap-3 rounded-[--radius-sm] px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-primary-bg/50 hover:text-primary disabled:opacity-50"
          >
            <SwitchIcon />
            {previewLoading ? "Switching…" : "Try as Student"}
          </button>
        </nav>

        {/* Bottom */}
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
            <AccountIcon active={pathname.startsWith("/account")} />
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

      {/* Mobile header for teachers */}
      <div className="flex flex-1 flex-col md:min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border-light bg-surface/90 px-4 backdrop-blur-md md:hidden">
          <Link href="/school/teacher" className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="text-sm font-bold text-text-primary">
              {user?.school_name || "Teacher"}
            </span>
          </Link>
          <button
            onClick={logout}
            className="rounded-[--radius-sm] px-2 py-1 text-xs font-medium text-text-muted hover:text-error"
          >
            Sign Out
          </button>
        </header>

        <main id="main-content" className="flex-1 px-6 py-8">
          {children}
        </main>

        {/* Mobile bottom tab bar for teachers */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-surface/95 backdrop-blur-md md:hidden">
          <div className="flex h-16 items-stretch">
            {teacherNavItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                    active ? "text-primary" : "text-text-muted",
                  )}
                >
                  <item.icon active={active} />
                  <span className="text-[9px] font-semibold">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

// ── Icons ──

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function AccountIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LearnIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function CoursesIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function SwitchIcon() {
  return (
    <svg className="h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H4" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h16" />
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
