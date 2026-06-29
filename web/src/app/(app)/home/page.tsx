"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuthStore } from "@/stores/auth";
import Link from "next/link";
import { PageMasthead } from "@/components/shared/page-masthead";
import { PageErrorState } from "@/components/ui";
import { auth, student, type EnrolledCourse } from "@/lib/api";
import { SUBJECT_CONFIG } from "@/lib/constants";
import { TOUR_IDS, useTour } from "@/components/tour";

const genericSubjects = [
  { id: "math", description: "Algebra, equations, and word problems — worked one step at a time." },
  { id: "physics", description: "Mechanics, energy, and waves, with the reasoning made visible." },
  { id: "chemistry", description: "Reactions, balancing, and stoichiometry — built up from the idea." },
];

// Per-subject hue (the solid accent from SUBJECT_CONFIG), used only as a thin
// editorial spine — the card surface itself stays calm cream/green.
const ACCENT: Record<string, string> = {
  math: "#7C3AED",
  physics: "#0984E3",
  chemistry: "#00B894",
};

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  // Distinguishes a real fetch failure from a genuinely-empty enrollment:
  // an empty list is a personal learner (show subject cards), but a
  // failure must surface a retry — not silently downgrade a class-linked
  // student to the generic marketing cards.
  const [coursesError, setCoursesError] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  // Time-of-day greeting + date, computed client-side to avoid hydration drift.
  const [greeting, setGreeting] = useState("Welcome back");
  const [dateLabel, setDateLabel] = useState("");

  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

  useEffect(() => {
    const now = new Date();
    const h = now.getHours();
    setGreeting(
      h < 5 ? "Still at it" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening",
    );
    setDateLabel(
      now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    );
  }, []);

  // School students belong in the school portal — never on personal /home.
  useEffect(() => {
    if (user?.role === "student" && user.school_id) {
      router.replace("/school/student");
    }
  }, [user, router]);

  // ── First-run onboarding tour (personal learner) ──
  // /home is where a non-school learner (role "student", no school_id)
  // lands, so it's where the Field Guide tour auto-starts. Same guards
  // as the teacher/student auto-starts: latch once, never restart a live
  // tour, gate on persona + tours_seen. School students are redirected
  // away above and preview shadows carry someone else's tours_seen, so
  // both are excluded from the personal tour.
  const tour = useTour();
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (tour.isActive) return;
    if (!user || user.role !== "student" || user.school_id || user.is_preview) return;
    if (user.tours_seen.includes("personal")) return;
    // The spotlight is a desktop experience — don't auto-start on phones;
    // the manual re-entry still works at any width.
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 768px)").matches) return;
    const raf = requestAnimationFrame(() => {
      autoStartedRef.current = true;
      tour.start("personal");
    });
    return () => cancelAnimationFrame(raf);
  }, [user, tour]);

  const loadEnrolledCourses = () => {
    auth
      .enrolledCourses()
      .then((d) => {
        setEnrolledCourses(d.courses);
        setCoursesError(false);
      })
      .catch(() => setCoursesError(true))
      .finally(() => setLoadingCourses(false));
  };

  useEffect(() => {
    loadEnrolledCourses();
  }, []);

  async function handleJoinSection(e: React.FormEvent) {
    e.preventDefault();
    setJoining(true);
    setJoinError("");
    try {
      await student.joinSection(joinCode.trim());
      setJoinCode("");
      // The join endpoint stamps school_id on the user, flipping them into a
      // school student — reload and route them to the school portal.
      await useAuthStore.getState().loadUser();
      const refreshed = useAuthStore.getState().user;
      if (refreshed?.role === "student" && refreshed.school_id) {
        router.push("/school/student");
        return;
      }
      loadEnrolledCourses();
    } catch (err) {
      setJoinError((err as Error).message || "Invalid code");
    } finally {
      setJoining(false);
    }
  }

  const isSchoolStudent = enrolledCourses.length > 0;
  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="mx-auto max-w-3xl space-y-12 pb-20">
      <PageMasthead
        eyebrow={dateLabel}
        title={
          <>
            {greeting}, <span className="text-primary">{firstName}</span>.
          </>
        }
        subtitle={
          isSchoolStudent
            ? "Your classes are ready when you are."
            : "Three subjects, endless practice. Where will your curiosity go today?"
        }
      />

      {/* ── Subjects / Courses ── */}
      <section data-tour-id={TOUR_IDS.personalStart} className="space-y-5">
        {/* Eyebrow hidden on error — "Choose a subject" would contradict
            the retry surface and could imply the class-linked student has
            no classes when the load merely failed. */}
        {!coursesError && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            {isSchoolStudent ? "Your classes" : "Choose a subject"}
          </p>
        )}

        {loadingCourses ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-[--radius-lg] border border-border-light bg-surface"
              />
            ))}
          </div>
        ) : coursesError ? (
          <PageErrorState
            title="We couldn't load your classes"
            message="Your classes didn't load just now. This is usually a quick blip — try again."
            onRetry={() => {
              setLoadingCourses(true);
              loadEnrolledCourses();
            }}
          />
        ) : isSchoolStudent ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {enrolledCourses.map((course, i) => (
              <SubjectCard
                key={`${course.id}-${course.section_id}`}
                index={i + 1}
                accent={ACCENT[course.subject] ?? "#0E5238"}
                title={course.name}
                subtitle={`${course.teacher_name} · ${course.section_name}`}
                modes={["Learn", "Practice", "Mock Test"]}
                onClick={() =>
                  router.push(`/learn?subject=${course.subject}&section=${course.section_id}`)
                }
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {genericSubjects.map((s, i) => (
              <SubjectCard
                key={s.id}
                index={i + 1}
                accent={ACCENT[s.id]}
                title={SUBJECT_CONFIG[s.id]?.name ?? s.id}
                subtitle={s.description}
                modes={["Learn", "Mock Test"]}
                onClick={() => router.push(`/learn?subject=${s.id}`)}
                // Spotlight the first card for the tour's "Learn / Mock
                // Test" step — clicking it opens those modes on /learn.
                tourId={i === 0 ? TOUR_IDS.personalModes : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Join a class — quiet, secondary ── */}
      {user?.role !== "teacher" && (
        <section
          data-tour-id={TOUR_IDS.personalJoin}
          className="rounded-[--radius-lg] border border-border bg-surface/60 p-5"
        >
          <form onSubmit={handleJoinSection} className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-semibold text-text-primary">Have a class code?</p>
              <p className="text-xs text-text-muted">
                Join your teacher&apos;s class to get assignments and grades.
              </p>
            </div>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase());
                setJoinError("");
              }}
              placeholder="CODE"
              maxLength={6}
              aria-label="Class code"
              className="w-28 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-center text-sm font-mono font-semibold tracking-[0.2em] text-text-primary outline-none placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
            />
            <button
              type="submit"
              disabled={joinCode.trim().length < 4 || joining}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join"}
            </button>
            {joinError && <span className="w-full text-xs text-error">{joinError}</span>}
          </form>
        </section>
      )}

      {/* ── Upgrade — free, non-school students ── */}
      {user && !user.is_pro && !isSchoolStudent && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <Link
            href="/pricing"
            className="group flex items-center justify-between gap-4 rounded-[--radius-xl] border border-primary/20 bg-primary-bg/40 p-6 transition-colors hover:bg-primary-bg/70"
          >
            <div>
              <p className="font-serif text-xl text-text-primary">Veradic Pro</p>
              <p className="mt-1 max-w-md text-sm text-text-secondary">
                Unlimited sessions, mock exams, and work diagnosis — for everything you&apos;re
                working toward.
              </p>
            </div>
            <span className="shrink-0 rounded-[--radius-pill] bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform group-hover:translate-x-0.5">
              View plans
            </span>
          </Link>
        </motion.div>
      )}
    </div>
  );
}

function SubjectCard({
  index,
  accent,
  title,
  subtitle,
  modes,
  onClick,
  tourId,
}: {
  index: number;
  accent: string;
  title: string;
  subtitle: string;
  modes: string[];
  onClick: () => void;
  /** Optional `data-tour-id` — stamped on the first card so the
   *  onboarding tour can spotlight the subject launchpad. */
  tourId?: string;
}) {
  return (
    <motion.button
      data-tour-id={tourId}
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.06 * index }}
      whileHover={{ y: -3 }}
      className="group relative flex flex-col gap-2.5 overflow-hidden rounded-[--radius-lg] border border-border bg-surface p-6 pl-7 text-left transition-colors hover:border-primary/30 hover:shadow-md"
    >
      <span
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full"
        style={{ backgroundColor: accent }}
      />
      <span className="font-display-serif text-sm italic text-text-muted">
        {String(index).padStart(2, "0")}
      </span>
      <h3 className="font-serif text-[1.6rem] leading-tight text-text-primary">{title}</h3>
      <p className="text-[13px] leading-relaxed text-text-secondary">{subtitle}</p>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-primary">
        Start
        <span className="transition-transform group-hover:translate-x-1">→</span>
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wider text-text-muted">
          {modes.join(" · ")}
        </span>
      </div>
    </motion.button>
  );
}
