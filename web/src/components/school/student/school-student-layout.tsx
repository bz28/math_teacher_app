"use client";

import Link from "next/link";
import { useAuthStore } from "@/stores/auth";
import { LogoMark } from "@/components/shared/logo-mark";
import { Sidebar } from "./sidebar";

/**
 * Two-pane shell for the school-student portal: persistent sidebar
 * on md+, a lightweight top header on mobile. Mirrors the teacher
 * layout's shape so both audiences feel consistent.
 *
 * Role guarding is handled by the nested /school/student/layout.tsx;
 * this layer is pure chrome.
 */
export function SchoolStudentLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex flex-1">
      <Sidebar />

      <div className="flex flex-1 flex-col md:min-w-0">
        {/* Mobile header — sidebar is hidden, so we need brand + logout. */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border-light bg-surface/90 px-4 backdrop-blur-md md:hidden">
          <Link href="/school/student" className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="text-sm font-bold text-text-primary">
              {user?.school_name || "Veradic AI"}
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
      </div>
    </div>
  );
}
