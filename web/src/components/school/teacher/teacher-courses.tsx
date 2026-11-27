"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { teacher, type TeacherCourse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The teacher's courses, for the shell: the sidebar lists them with
 * what's waiting in each, the phone header folds the same list into a
 * menu, and deep pages name the course in their breadcrumb.
 *
 * Read once per navigation (a new page is when a count can have moved:
 * grades approved, a course just made), keeping the last list on screen
 * while the next one loads. Null until the first read lands; a failed
 * read keeps whatever was there — this is a convenience, not the page.
 */
const TeacherCoursesContext = createContext<TeacherCourse[] | null>(null);

export function TeacherCoursesProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [courses, setCourses] = useState<TeacherCourse[] | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    teacher
      .courses()
      .then((res) => {
        if (mounted.current) setCourses(res.courses.filter((c) => c.status !== "archived"));
      })
      .catch(() => undefined);
  }, [pathname]);
  return (
    <TeacherCoursesContext.Provider value={courses}>{children}</TeacherCoursesContext.Provider>
  );
}

export function useTeacherCourses(): TeacherCourse[] | null {
  return useContext(TeacherCoursesContext);
}

/** The course's name for a breadcrumb, or null while the list loads. */
export function useCourseName(courseId: string): string | null {
  return useTeacherCourses()?.find((c) => c.id === courseId)?.name ?? null;
}

/** The course the URL is inside, if any: /school/teacher/courses/<id>/… */
export function courseIdFromPath(pathname: string | null): string | null {
  return pathname?.match(/^\/school\/teacher\/courses\/([^/?#]+)/)?.[1] ?? null;
}

function ToReview({ n, active }: { n: number; active: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-[--radius-pill] px-1.5 text-[11px] font-semibold tabular-nums leading-5",
        active
          ? "bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning-dark)]"
          : "text-[color:var(--color-warning-dark)]",
      )}
      aria-label={`${n} to review`}
    >
      {n}
    </span>
  );
}

/**
 * The sidebar's course list, nested under Courses: one row per course,
 * its to-review count at the right, the course you're in marked by the
 * same primary rule the nav uses. Switching courses is one click from
 * anywhere.
 */
export function CourseNavList() {
  const courses = useTeacherCourses();
  const current = courseIdFromPath(usePathname());
  if (!courses || courses.length === 0) return null;
  return (
    <ul aria-label="Your courses" className="ml-[22px] mt-1 space-y-px border-l border-border-light">
      {courses.map((c) => {
        const active = c.id === current;
        return (
          <li key={c.id} className="relative">
            {active && (
              <span
                aria-hidden
                className="pointer-events-none absolute -left-px top-1 bottom-1 w-[2px] bg-[color:var(--color-primary)]"
              />
            )}
            <Link
              href={`/school/teacher/courses/${c.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 py-1.5 pl-3.5 pr-2 text-[13px] transition-colors",
                active
                  ? "font-semibold text-text-primary"
                  : "font-medium text-text-secondary hover:text-text-primary",
              )}
            >
              <span className="min-w-0 truncate">{c.name}</span>
              <ToReview n={c.to_review} active={active} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The phone's version: a phone has no sidebar, so the header carries a
 * menu named for the course you're in ("Courses" elsewhere) that opens
 * the same list. `fallback` shows until there's a course to list.
 */
export function MobileCourseMenu({ fallback }: { fallback: React.ReactNode }) {
  const courses = useTeacherCourses();
  const pathname = usePathname();
  const current = courseIdFromPath(pathname);
  const [open, setOpen] = useState(false);
  // A navigation closes it; the list itself is the way out.
  const [openedAt, setOpenedAt] = useState(pathname);
  if (openedAt !== pathname) {
    setOpenedAt(pathname);
    setOpen(false);
  }
  const root = useRef<HTMLDivElement>(null);
  // A tap outside or Escape closes it too, as any menu does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!courses || courses.length === 0) return <>{fallback}</>;
  const currentName = courses.find((c) => c.id === current)?.name;
  const waiting = courses.reduce((s, c) => s + Math.max(0, c.to_review), 0);
  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-course-menu"
        className="flex min-w-0 max-w-[11rem] items-center gap-1.5 rounded-[--radius-sm] border border-border-light px-2 py-1 text-xs font-semibold text-text-primary"
      >
        <span className="truncate">{currentName ?? "Courses"}</span>
        {!currentName && waiting > 0 && (
          <span className="tabular-nums text-[color:var(--color-warning-dark)]">{waiting}</span>
        )}
        <span aria-hidden className="text-text-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          id="mobile-course-menu"
          className="absolute left-0 top-full z-50 mt-2 w-64 rounded-[--radius-md] border border-border-light bg-surface py-1 shadow-lg"
        >
          <Link
            href="/school/teacher"
            className="block px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary"
          >
            All courses
          </Link>
          <ul className="border-t border-border-light pt-1">
            {courses.map((c) => {
              const active = c.id === current;
              return (
                <li key={c.id}>
                  <Link
                    href={`/school/teacher/courses/${c.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm",
                      active ? "font-semibold text-text-primary" : "text-text-secondary",
                    )}
                  >
                    <span className="min-w-0 truncate">{c.name}</span>
                    <ToReview n={c.to_review} active={active} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
