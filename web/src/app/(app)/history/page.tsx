"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  session as sessionApi,
  schoolStudent,
  type SessionHistoryItem,
  type SchoolHistoryResponse,
  type SchoolHistoryItem,
} from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useSessionStore, type Subject } from "@/stores/learn";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { SkeletonCard } from "@/components/ui/skeleton";
import { CheckIcon } from "@/components/ui/icons";
import { MathText } from "@/components/shared/math-text";
import { formatRelativeDate, cn } from "@/lib/utils";

export default function HistoryPage() {
  const user = useAuthStore((s) => s.user);
  const isSchoolStudent = !!(user?.role === "student" && user.school_id);

  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

  return isSchoolStudent ? <SchoolHistory /> : <PersonalHistory />;
}

// ── Personal-student view: subject tabs (unchanged behavior) ───────────────

function PersonalHistory() {
  const router = useRouter();
  const { setSubject } = useSessionStore();
  const [subject, setLocalSubject] = useState<Subject>("math");
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const fetchHistory = useCallback(async (sub: Subject, offset = 0) => {
    setLoading(true);
    try {
      const res = await sessionApi.history({ subject: sub }, 20, offset);
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setHasMore(res.has_more);
    } catch {
      // empty state handles it
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory(subject);
  }, [subject, fetchHistory]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Heading />
      <div className="flex gap-2">
        {(["math", "physics", "chemistry"] as const).map((sub) => (
          <TabButton
            key={sub}
            active={subject === sub}
            onClick={() => {
              setLocalSubject(sub);
              setItems([]);
            }}
          >
            {sub === "math" ? "Mathematics" : sub === "physics" ? "Physics" : "Chemistry"}
          </TabButton>
        ))}
      </div>
      <SessionList
        loading={loading}
        items={items}
        hasMore={hasMore}
        onLoadMore={() => fetchHistory(subject, items.length)}
        onReview={(item) => {
          setSubject(subject);
          router.push(`/history/${item.id}?subject=${subject}`);
        }}
        emptyAction={
          <Button variant="secondary" onClick={() => router.push(`/learn?subject=${subject}`)}>
            Start Learning
          </Button>
        }
      />
    </div>
  );
}

// ── School-student view: Learn attempts grouped by homework ────────────────
//
// Populated from BankConsumption rows (context='learn') via the new
// /v1/school/student/history endpoint. Practice rows are deliberately
// excluded — revisiting a past MCQ has no study value; the Practice →
// Learn pivot on the Practice completion screen is the bridge that
// promotes a practiced problem into the history.

function SchoolHistory() {
  const router = useRouter();
  const [data, setData] = useState<SchoolHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // `null` means "use the first course" — we don't auto-seed on load
  // because that would require a sync setState in an effect (React
  // lint rule catches it). Only set when the user explicitly taps a
  // tab; otherwise fall back to `data.courses[0]`.
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  useEffect(() => {
    schoolStudent
      .historyList()
      .then((res) => setData(res))
      .catch(() => setData({ courses: [] }))
      .finally(() => setLoading(false));
  }, []);

  const activeCourse = useMemo(() => {
    if (!data?.courses.length) return null;
    if (selectedCourseId) {
      return data.courses.find((c) => c.course_id === selectedCourseId) ?? data.courses[0];
    }
    return data.courses[0];
  }, [data, selectedCourseId]);

  const activeCourseId = activeCourse?.course_id ?? null;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Heading />
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (!data || data.courses.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Heading />
        <EmptyState
          title="Nothing here yet"
          description="Work through a Learn problem from your homework and it'll show up here."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Heading />
      {data.courses.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {data.courses.map((c) => (
            <TabButton
              key={c.course_id}
              active={activeCourseId === c.course_id}
              onClick={() => setSelectedCourseId(c.course_id)}
            >
              {c.course_name}
            </TabButton>
          ))}
        </div>
      )}

      {activeCourse === null || activeCourse.homeworks.length === 0 ? (
        <EmptyState
          title="No history in this course yet"
          description="Start a Learn problem from your homework to see it here."
        />
      ) : (
        <div className="space-y-6">
          {activeCourse.homeworks.map((hw) => (
            <section key={hw.assignment_id} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold text-text-primary">
                  {hw.assignment_title}
                </h2>
                <span className="text-xs text-text-muted">
                  most recent: {formatRelativeDate(hw.most_recent_activity)}
                </span>
              </div>
              <div className="space-y-2">
                {hw.items.map((item) => (
                  <HistoryRow
                    key={item.consumption_id}
                    item={item}
                    onOpen={() =>
                      router.push(`/school/student/history/${item.consumption_id}`)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  item,
  onOpen,
}: {
  item: SchoolHistoryItem;
  onOpen: () => void;
}) {
  const completed = item.status === "completed";
  return (
    <Card variant="interactive" onClick={onOpen} className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs",
          completed ? "bg-success text-white" : "bg-text-muted text-white",
        )}
      >
        {completed ? (
          <CheckIcon className="h-3 w-3" strokeWidth={3} />
        ) : (
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {item.variation_title ? (
            item.variation_title
          ) : (
            <MathText text={item.variation_question} />
          )}
        </div>
        <p className="mt-0.5 text-xs text-text-muted">
          {item.anchor_position > 0
            ? `Similar to Problem ${item.anchor_position} · `
            : ""}
          {completed ? "Learned" : "In progress"} ·{" "}
          {formatRelativeDate(item.served_at)}
        </p>
      </div>
      <Badge variant={completed ? "success" : "muted"}>
        {completed ? "Re-open" : "Continue"}
      </Badge>
    </Card>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────

function Heading() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
        Session History
      </h1>
    </motion.div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-[--radius-pill] px-4 py-2 text-sm font-semibold transition-colors",
        active
          ? "bg-primary text-white"
          : "bg-primary-bg text-primary hover:bg-primary/10",
      )}
    >
      {children}
    </button>
  );
}

function SessionList({
  loading,
  items,
  hasMore,
  onLoadMore,
  onReview,
  emptyAction,
}: {
  loading: boolean;
  items: SessionHistoryItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  onReview: (item: SessionHistoryItem) => void;
  emptyAction: React.ReactNode;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No sessions yet"
        description="Your past sessions will show up here once you start one."
        action={emptyAction}
      />
    );
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 * i }}
        >
          <Card
            variant="interactive"
            onClick={() => onReview(item)}
            className="flex items-start gap-3"
          >
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs",
                item.status === "completed"
                  ? "bg-success text-white"
                  : "bg-text-muted text-white",
              )}
            >
              {item.status === "completed" ? (
                <CheckIcon className="h-3 w-3" strokeWidth={3} />
              ) : (
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              )}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">
                {item.problem.includes("[") && (
                  <svg className="mr-1 inline h-3.5 w-3.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
                {item.problem}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {item.current_step}/{item.total_steps} steps &middot;{" "}
                {formatRelativeDate(item.created_at)}
              </p>
            </div>
            <Badge variant={item.status === "completed" ? "success" : "muted"}>
              {item.status}
            </Badge>
          </Card>
        </motion.div>
      ))}
      {hasMore && (
        <Button variant="ghost" className="w-full" onClick={onLoadMore} loading={loading}>
          Load More
        </Button>
      )}
    </div>
  );
}
