"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  session as sessionApi,
  auth as authApi,
  type SessionHistoryItem,
  type EnrolledCourse,
} from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useSessionStore, type Subject } from "@/stores/learn";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { SkeletonCard } from "@/components/ui/skeleton";
import { CheckIcon } from "@/components/ui/icons";
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

// ── School-student view: one tab per enrolled course ──────────────────────

// TODO(school-history): This tab will be empty in practice until school
// students have an entry point that creates section-tagged Session rows.
// Today they reach the tutor only through the homework/practice flow,
// which writes BankConsumption + Submission, not Session. Two known
// ways to close the gap: (a) add an "Ask a problem" button inside
// /school/student that opens a section-scoped learn page, or (b) change
// this endpoint to read BankConsumption and render practice history.
// Neither is in scope for this PR — see plans/school-portal-cleanup-round-2.md.
function SchoolHistory() {
  const router = useRouter();
  const [courses, setCourses] = useState<EnrolledCourse[] | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    authApi
      .enrolledCourses()
      .then((res) => {
        setCourses(res.courses);
        if (res.courses.length > 0) setActiveSectionId(res.courses[0].section_id);
        else setLoading(false);
      })
      .catch(() => {
        setCourses([]);
        setLoading(false);
      });
  }, []);

  const fetchHistory = useCallback(async (sectionId: string, offset = 0) => {
    setLoading(true);
    try {
      const res = await sessionApi.history({ section_id: sectionId }, 20, offset);
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setHasMore(res.has_more);
    } catch {
      // empty state handles it
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSectionId) fetchHistory(activeSectionId);
  }, [activeSectionId, fetchHistory]);

  if (courses !== null && courses.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Heading />
        <EmptyState
          title="No classes yet"
          description="Ask your teacher for an invite or join code to see history for your classes here."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Heading />
      {courses && courses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {courses.map((c) => (
            <TabButton
              key={c.section_id}
              active={activeSectionId === c.section_id}
              onClick={() => {
                if (activeSectionId !== c.section_id) {
                  setItems([]);
                  setActiveSectionId(c.section_id);
                }
              }}
            >
              {c.name}
              <span className="ml-1 text-xs opacity-70">· {c.section_name}</span>
            </TabButton>
          ))}
        </div>
      )}
      <SessionList
        loading={loading}
        items={items}
        hasMore={hasMore}
        onLoadMore={() => activeSectionId && fetchHistory(activeSectionId, items.length)}
        onReview={(item) => router.push(`/history/${item.id}`)}
        emptyAction={null}
      />
    </div>
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
