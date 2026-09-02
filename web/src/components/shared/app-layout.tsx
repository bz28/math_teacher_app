"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import {
  teacher,
  schoolStudent,
  enterPreviewMode,
  exitPreviewMode,
  isInPreviewMode,
  type PreviewSeat,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/shared/logo-mark";
import { SkipToMainLink } from "@/components/shared/skip-to-main-link";
import { SchoolStudentLayout } from "@/components/school/student/school-student-layout";
import { TeacherUsagePill } from "@/components/shared/teacher-usage-pill";
import { useToast } from "@/components/ui";
import { FlagIcon } from "@/components/ui/icons";
import { useTour } from "@/components/tour";

// ── Student nav items ──

const studentNavItems = [
  { label: "Home", href: "/home", icon: HomeIcon },
  { label: "History", href: "/history", icon: HistoryIcon },
  { label: "Review", href: "/review", icon: ReviewIcon },
  { label: "Account", href: "/account", icon: AccountIcon },
];

// ── Teacher nav items ──

const teacherNavItems = [
  { label: "Courses", href: "/school/teacher", icon: CoursesIcon },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const pathname = usePathname();
  const isTeacher = user?.role === "teacher";
  // School-linked students get their own sidebar shell — but only
  // inside the school world. On shared routes (/account) and personal
  // routes (/home, /history, /learn, /practice), the regular top-bar
  // layout keeps its nav coherent: otherwise a school student on
  // /home would see a sidebar whose nav items point nowhere useful.
  //
  // Preview shadows of solo teachers (no school_id) also belong in
  // this shell — the whole point of the student preview is to see the
  // school-student experience, not the personal study app's nav.
  const isSchoolStudent =
    user?.role === "student" && (!!user?.school_id || user.is_preview);
  const inSchoolWorld =
    pathname.startsWith("/school/student") || pathname === "/account";

  let inner: React.ReactNode;
  if (isTeacher) {
    inner = <TeacherLayout>{children}</TeacherLayout>;
  } else if (isSchoolStudent && inSchoolWorld) {
    inner = <SchoolStudentLayout>{children}</SchoolStudentLayout>;
  } else {
    inner = <StudentLayout>{children}</StudentLayout>;
  }

  // Preview banner hoisted out of SchoolStudentLayout so a previewing
  // teacher always sees the exit affordance — including on routes
  // that don't land in the school-student shell (e.g. /pricing, /home,
  // /history, /learn). Previously the banner only existed inside
  // SchoolStudentLayout, so a preview teacher navigating off
  // /school/student/* + /account was stranded with no way back.
  const preview = typeof window !== "undefined" && isInPreviewMode();
  if (!preview) return inner;
  return (
    <div className="flex flex-1 flex-col">
      <PreviewBanner />
      {inner}
    </div>
  );
}

/**
 * Which course the preview is looking at, read off the URL.
 *
 * The banner is mounted above every route, so it has no course prop.
 * Every course-scoped student route is /school/student/courses/<id>/…,
 * and the seat switcher only means something inside one — on the
 * dashboard "which period am I in" has no single answer, so it hides.
 */
function useCourseIdFromPath(): string | null {
  const pathname = usePathname();
  const match = pathname?.match(/^\/school\/student\/courses\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Seat switcher — lets a previewing teacher move between her own class
 * periods.
 *
 * Her shadow holds one seat per course (one enrollment per student per
 * course is a DB constraint), which is the right shape — a real student
 * sits in one period — but it meant she could only ever see one. The
 * question she actually has is "did this go to the right class?", and
 * answering it needs both the period that has the homework AND the one
 * that shouldn't.
 *
 * Renders nothing until it knows there's a real choice to offer: one
 * section is the common case and a dropdown with a single option is
 * noise. A failed fetch is silent for the same reason — this is an
 * affordance, not a task, and a broken one should get out of the way
 * rather than put an error in the chrome above every page.
 */
function SeatSwitcher({ courseId }: { courseId: string }) {
  const toast = useToast();
  const [seats, setSeats] = useState<PreviewSeat[] | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    schoolStudent
      .previewSeats(courseId)
      .then((res) => {
        if (!cancelled) setSeats(res.seats);
      })
      .catch(() => {
        if (!cancelled) setSeats([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (seats === null || seats.length < 2) return null;
  const current = seats.find((s) => s.current);

  return (
    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]">
      <span className="sr-only">Previewing as a student in</span>
      <span aria-hidden className="opacity-50">
        ·
      </span>
      <select
        value={current?.section_id ?? ""}
        disabled={moving}
        onChange={async (e) => {
          const next = e.target.value;
          if (!next || next === current?.section_id) return;
          setMoving(true);
          try {
            await schoolStudent.movePreviewSeat(courseId, next);
            // Full reload, not router.refresh(). Everything on screen
            // was rendered for the old seat, and most of it — the class
            // list in the sidebar, the homework list, grades — is
            // client-fetched in effects that a refresh() doesn't re-run.
            // Refreshing alone left the banner saying Period 4 with the
            // sidebar still saying Period 2. Switching seats is a
            // deliberate, occasional act; paying for a clean reload is
            // better than a page that half-agrees with itself.
            window.location.reload();
          } catch {
            toast.error("Couldn't switch section. Try again in a moment.");
          } finally {
            setMoving(false);
          }
        }}
        className="rounded-[--radius-sm] border border-[color:var(--color-primary)]/40 bg-surface/70 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[color:var(--color-primary-dark)] disabled:opacity-50"
      >
        {seats.map((s) => (
          <option key={s.section_id} value={s.section_id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreviewBanner() {
  const router = useRouter();
  const loadUser = useAuthStore((s) => s.loadUser);
  const courseId = useCourseIdFromPath();
  // Thin warm-paper bar with primary accent rule and small-caps copy.
  // Replaces the prior solid-green bar — restrained, matches dashboard's
  // editorial restraint while still being unmissable.
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 border-b border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-bg)] px-4 py-1.5 text-[color:var(--color-primary-dark)]">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
        Previewing as student
      </span>
      {courseId && <SeatSwitcher courseId={courseId} />}
      <button
        onClick={async () => {
          exitPreviewMode();
          await loadUser();
          router.push("/school/teacher");
        }}
        className="rounded-[--radius-sm] border border-[color:var(--color-primary)]/40 px-3 py-0.5 text-xs font-semibold tracking-[0.01em] text-[color:var(--color-primary-dark)] transition-colors hover:bg-[color:var(--color-primary)]/10"
      >
        Back to teacher view
      </button>
    </div>
  );
}

// ── Student layout (existing top bar + bottom tabs) ──

function StudentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const tour = useTour();
  // School-linked students only start sessions from class-scoped flows;
  // the Learn tab would drop them into the personal free-form path.
  const showLearnTab = !user?.school_id;
  // The personal-learner tour belongs only to non-school learners; a
  // school student who wanders to a personal route (they carry school_id)
  // has their own "student" tour in the school sidebar instead.
  const isPersonalLearner = user?.role === "student" && !user?.school_id;
  // History is dead weight for school-linked students: their tutor time
  // runs through homework/practice flows, which write Submission rows,
  // not the section-tagged Session rows /history reads — so the tab is
  // always empty for them. Drop it from their nav; personal learners
  // keep it (their free-form sessions populate it).
  const navItems = user?.school_id
    ? studentNavItems.filter((item) => item.href !== "/history")
    : studentNavItems;

  return (
    <div className="flex flex-1 flex-col">
      <SkipToMainLink />

      {/* Top bar — warm paper, hairline-bottom border. Nav uses an
          underline-on-active treatment (decision B): no tinted pill
          backgrounds, just text color + 2px accent underline. Same
          editorial restraint as the dashboard's sidebar nav. */}
      <header className="sticky top-0 z-40 border-b border-border-light bg-[color:var(--color-surface-alt)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-7">
            <Link href="/home" className="flex items-center gap-2">
              <LogoMark size={28} />
              <span className="text-base font-bold tracking-[-0.01em] text-text-primary">
                Veradic AI
              </span>
            </Link>

            <nav className="hidden items-center gap-5 md:flex">
              {navItems.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-1.5 py-1 text-sm font-medium transition-colors",
                      active
                        ? "text-text-primary"
                        : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    <item.icon active={active} />
                    {item.label}
                    {active && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] bg-[color:var(--color-primary)]"
                      />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {isPersonalLearner && (
              <button
                onClick={() => tour.start("personal")}
                className="hidden rounded-[--radius-sm] px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary sm:block"
              >
                Take the tour
              </button>
            )}
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

      {/* Mobile bottom tab bar — hairline top, active state uses ink
          text + thin top-edge accent (no tinted pill bg). */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-[color:var(--color-surface-alt)]/95 backdrop-blur-md md:hidden">
        <div className="flex h-16 items-stretch">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-text-primary" : "text-text-muted",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-6 top-0 h-[2px] bg-[color:var(--color-primary)]"
                  />
                )}
                <item.icon active={active} />
                <span className="text-[10px] font-semibold">{item.label}</span>
              </Link>
            );
          })}
          {showLearnTab && (
            <Link
              href="/learn"
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                pathname.startsWith("/learn") ? "text-text-primary" : "text-text-muted",
              )}
            >
              {pathname.startsWith("/learn") && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-6 top-0 h-[2px] bg-[color:var(--color-primary)]"
                />
              )}
              <LearnIcon active={pathname.startsWith("/learn")} />
              <span className="text-[10px] font-semibold">Learn</span>
            </Link>
          )}
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
  const toast = useToast();
  const tour = useTour();
  const [previewLoading, setPreviewLoading] = useState(false);

  return (
    <div className="flex flex-1">
      <SkipToMainLink />
      {/* Sidebar — paper-2 warm cream surface, hairline divider; nav
          uses dashboard-style sliding accent rule on active state
          (decision B applied to teacher sidebar too). */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border-light bg-[color:var(--color-surface-alt-2)] md:flex">
        {/* Brand block — wordmark + serif-italic school/role sub. */}
        <div className="flex h-16 items-center gap-2.5 border-b border-border-light px-5">
          <LogoMark size={32} />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-[-0.01em] text-text-primary">Veradic AI</div>
            <div className="truncate font-serif italic text-[13px] text-text-muted">
              {user?.school_name || "Teacher"}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
          {teacherNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                  active
                    ? "font-semibold text-text-primary"
                    : "font-medium text-text-secondary hover:text-text-primary",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-1 left-3 h-[1px] w-5 bg-[color:var(--color-primary)]"
                  />
                )}
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
                // Surface feedback so the click doesn't look broken —
                // teacher stays on the teacher view, can retry.
                toast.error("Couldn't switch to student preview. Try again in a moment.");
              } finally {
                setPreviewLoading(false);
              }
            }}
            disabled={previewLoading}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
          >
            <SwitchIcon />
            {previewLoading ? "Switching…" : "Preview as student"}
          </button>

          {/* Re-enter the Field Guide tour anytime — never touches data.
              Step one anchors the New-course button + handoff dialog that
              exist only on /school/teacher, so navigate there first (from
              wherever in the workspace the teacher opened the menu) before
              starting, or the tour lands on a missing target. */}
          <button
            onClick={() => {
              router.push("/school/teacher");
              tour.start("teacher");
            }}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <CompassIcon />
            Take the tour
          </button>
        </nav>

        {/* Bottom */}
        <div className="border-t border-border-light px-3 py-3">
          {/* Status-weight meter for free independent teachers — sits with
              identity at the bottom, matches SaaS convention. Server-gated;
              renders null for school / Pro / non-teacher. */}
          <TeacherUsagePill />

          <Link
            href="/account"
            className={cn(
              "relative flex items-center gap-3 px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/account")
                ? "font-semibold text-text-primary"
                : "font-medium text-text-secondary hover:text-text-primary",
            )}
          >
            {pathname.startsWith("/account") && (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-1 left-3 h-[1px] w-5 bg-[color:var(--color-primary)]"
              />
            )}
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

      {/* Mobile header for teachers — paper-2 warm cream, hairline-bottom. */}
      <div className="flex flex-1 flex-col md:min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border-light bg-[color:var(--color-surface-alt-2)]/90 px-4 backdrop-blur-md md:hidden">
          <Link href="/school/teacher" className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="text-sm font-bold tracking-[-0.01em] text-text-primary">
              {user?.school_name || "Teacher"}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {/* Compact meter for free teachers — same gating as the sidebar pill. */}
            <TeacherUsagePill compact />
            <button
              onClick={logout}
              className="rounded-[--radius-sm] px-2 py-1 text-xs font-medium text-text-muted hover:text-error"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 px-6 py-8">
          {children}
        </main>

        {/* Mobile bottom tab bar for teachers — same underline-active
            treatment as the student bar. */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-[color:var(--color-surface-alt)]/95 backdrop-blur-md md:hidden">
          <div className="flex h-16 items-stretch">
            {teacherNavItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                    active ? "text-text-primary" : "text-text-muted",
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-6 top-0 h-[2px] bg-[color:var(--color-primary)]"
                    />
                  )}
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
    <svg className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function ReviewIcon({ active }: { active: boolean }) {
  // Reuses the shared FlagIcon glyph (flagged work → Review), adapted to
  // the nav's active-aware coloring contract.
  return (
    <FlagIcon
      className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")}
    />
  );
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function AccountIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LearnIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  );
}

function CoursesIcon({ active }: { active: boolean }) {
  return (
    <svg className={cn("h-5 w-5", active ? "text-text-primary" : "text-text-muted")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function CompassIcon() {
  return (
    <svg className="h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polygon points="16.2 7.8 13.4 13.4 7.8 16.2 10.6 10.6 16.2 7.8" />
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
