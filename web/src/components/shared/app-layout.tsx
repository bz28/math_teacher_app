"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Home", href: "/home", icon: HomeIcon },
  { label: "History", href: "/history", icon: HistoryIcon },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <div className="flex flex-1 flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border-light bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <Link href="/home" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-gradient-to-br from-primary to-primary-light">
                <span className="text-xs font-extrabold text-white">V</span>
              </div>
              <span className="text-base font-bold tracking-tight text-text-primary">
                Veradic AI
              </span>
            </Link>

            {/* Desktop nav links */}
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => {
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

          {/* User menu */}
          <div className="flex items-center gap-3">
            <ThemeToggle />
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

      {/* Page content — add bottom padding on mobile for tab bar */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 pb-24 md:pb-8">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-surface/95 backdrop-blur-md md:hidden">
        <div className="flex h-16 items-stretch">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                  active
                    ? "text-primary"
                    : "text-text-muted",
                )}
              >
                <item.icon active={active} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </Link>
            );
          })}
          {/* Learn shortcut */}
          <Link
            href="/learn"
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
              pathname.startsWith("/learn")
                ? "text-primary"
                : "text-text-muted",
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

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function LearnIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={cn("h-5 w-5", active ? "text-primary" : "text-text-muted")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}
