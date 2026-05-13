"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { exitPreviewMode, isInPreviewMode } from "@/lib/api";
import { LogoMark } from "@/components/shared/logo-mark";
import { MobileSidebarDrawer, Sidebar } from "./sidebar";

/**
 * Two-pane shell for the school-student portal:
 * - md+: persistent sidebar on the left.
 * - <md: hamburger in the mobile header opens a drawer with the
 *   same nav + class list. Without this, "My Grades" was
 *   unreachable on mobile — the old layout only showed the logo
 *   and sign-out.
 *
 * Role guarding stays in the nested /school/student/layout.tsx;
 * this layer is pure chrome.
 */
export function SchoolStudentLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, loadUser } = useAuthStore();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Banner lives at the shell level so a previewing teacher always
  // has a way back, including on shared routes like /account.
  // Previously it was inside the inner /school/student/layout.tsx and
  // disappeared when navigating off /school/student/*, stranding the
  // teacher in a shadow session.
  const preview = typeof window !== "undefined" && isInPreviewMode();

  return (
    <div className="flex flex-1 flex-col">
      {preview && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm font-medium text-white">
          <span>Previewing as student</span>
          <button
            onClick={async () => {
              exitPreviewMode();
              await loadUser();
              router.push("/school/teacher");
            }}
            className="rounded-full border border-white/30 px-3 py-0.5 text-xs font-bold hover:bg-white/20"
          >
            Back to teacher view
          </button>
        </div>
      )}
      <div className="flex flex-1">
      <Sidebar />
      <MobileSidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <div className="flex flex-1 flex-col md:min-w-0">
        {/* Mobile header — hamburger opens the drawer, keeps sign-out
            reachable as a last-resort action. */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border-light bg-surface/90 px-4 backdrop-blur-md md:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="rounded-[--radius-sm] p-1.5 text-text-primary transition-colors hover:bg-surface-hover"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <Link href="/school/student" className="flex items-center gap-2">
              <LogoMark size={24} />
              <span className="text-sm font-bold text-text-primary">
                {user?.school_name || "Veradic AI"}
              </span>
            </Link>
          </div>
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
    </div>
  );
}
