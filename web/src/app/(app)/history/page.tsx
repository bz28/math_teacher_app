"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { MathText } from "@/components/shared/math-text";
import { formatRelativeDate, formatDateTime, cn } from "@/lib/utils";

export default function HistoryPage() {
  return (
    <Suspense>
      <HistoryPageContent />
    </Suspense>
  );
}

function HistoryPageContent() {
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
  const searchParams = useSearchParams();
  const selectMode = searchParams.get("select") === "true";
  const initialSubject = (searchParams.get("subject") ?? "math") as Subject;
  const initialMode = searchParams.get("mode") ?? "all";
  const initialTopic = searchParams.get("topic") ?? "all";

  const { setSubject, setProblemQueue, startSession } = useSessionStore();
  const [subject, setLocalSubjectState] = useState<Subject>(initialSubject);
  const [modeFilter, setModeFilterState] = useState<string>(initialMode);
  const [topicFilter, setTopicFilterState] = useState<string>(initialTopic);
  const [topics, setTopics] = useState<string[]>([]);
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Map<string, SessionHistoryItem>>(new Map());

  // Sync filter state to URL so filters persist across navigation.
  // Always pass all three values explicitly to avoid stale closures.
  function updateFilters(sub: Subject, mode: string, topic: string) {
    setLocalSubjectState(sub);
    setModeFilterState(mode);
    setTopicFilterState(topic);
    const params = new URLSearchParams();
    params.set("subject", sub);
    if (mode !== "all") params.set("mode", mode);
    if (topic !== "all") params.set("topic", topic);
    if (selectMode) params.set("select", "true");
    router.replace(`/history?${params.toString()}`, { scroll: false });
  }

  const fetchHistory = useCallback(async (sub: Subject, mode: string, topic: string, offset = 0) => {
    setLoading(true);
    try {
      const filter: { subject: string; mode?: string; topic?: string } = { subject: sub };
      if (mode !== "all") filter.mode = mode;
      if (topic !== "all") filter.topic = topic;
      const res = await sessionApi.history(filter, 20, offset);
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setHasMore(res.has_more);
    } catch {
      // empty state handles it
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch topics for dropdown when subject changes
  useEffect(() => {
    sessionApi.historyTopics(subject).then((res) => setTopics(res.topics)).catch(() => setTopics([]));
  }, [subject]);

  // Fetch history when any filter changes
  useEffect(() => {
    fetchHistory(subject, modeFilter, topicFilter);
  }, [subject, modeFilter, topicFilter, fetchHistory]);

  function toggleSelect(item: SessionHistoryItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  function handleGenerate() {
    const problems: string[] = [];
    for (const item of selected.values()) {
      if (item.mode === "mock_test") {
        problems.push(...item.all_problems);
      } else {
        problems.push(item.problem);
      }
    }
    if (problems.length === 0) return;
    setSubject(subject);
    setProblemQueue(problems.slice(0, 10).map((p) => ({ text: p })));
    router.push(`/learn?subject=${subject}&from=history`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Heading />

      {/* Subject filter */}
      <div className="flex gap-2">
        {(["math", "physics", "chemistry"] as const).map((sub) => (
          <TabButton
            key={sub}
            active={subject === sub}
            onClick={() => {
              updateFilters(sub, "all", "all");
              setItems([]);
              setSelected(new Map());
            }}
          >
            {sub === "math" ? "Mathematics" : sub === "physics" ? "Physics" : "Chemistry"}
          </TabButton>
        ))}
      </div>

      {/* Mode + Topic filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-border bg-surface p-0.5">
          {([
            { id: "all", label: "All" },
            { id: "learn", label: "Learn" },
            { id: "mock_test", label: "Mock Test" },
          ] as const).map((m) => (
            <button
              key={m.id}
              onClick={() => { updateFilters(subject, m.id, "all"); setItems([]); }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                modeFilter === m.id
                  ? "bg-primary text-white"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {topics.length > 0 && (
          <select
            value={topicFilter}
            onChange={(e) => { updateFilters(subject, modeFilter, e.target.value); setItems([]); }}
            className="rounded-[--radius-md] border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary focus:border-primary focus:outline-none"
          >
            <option value="all">All Topics</option>
            {topics.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {/* Session list */}
      <SessionList
        loading={loading}
        items={items}
        hasMore={hasMore}
        onLoadMore={() => fetchHistory(subject, modeFilter, topicFilter, items.length)}
        onReview={(item) => {
          if (selectMode) {
            toggleSelect(item);
          } else {
            setSubject(subject);
            router.push(`/history/${item.id}?subject=${subject}`);
          }
        }}
        onLearnProblem={async (problem) => {
          setSubject(subject);
          router.push(`/learn/session?subject=${subject}`);
          await startSession(problem);
        }}
        selectMode={selectMode}
        selected={selected}
        emptyAction={
          <Button variant="secondary" onClick={() => router.push(`/learn?subject=${subject}`)}>
            Start Learning
          </Button>
        }
      />

      {/* Floating selection bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <button
            onClick={handleGenerate}
            className="flex items-center gap-3 rounded-full bg-primary px-6 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:scale-105"
          >
            {selected.size} selected
            <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
              Add to queue
            </span>
          </button>
        </div>
      )}
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
  onLearnProblem,
  selectMode = false,
  selected,
  emptyAction,
}: {
  loading: boolean;
  items: SessionHistoryItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  onReview: (item: SessionHistoryItem) => void;
  onLearnProblem?: (problem: string) => void;
  selectMode?: boolean;
  selected?: Map<string, SessionHistoryItem>;
  emptyAction: React.ReactNode;
}) {
  const [expandedMockId, setExpandedMockId] = useState<string | null>(null);

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
  const isMT = (item: SessionHistoryItem) => item.mode === "mock_test";

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isSelected = selected?.has(item.id) ?? false;
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * Math.min(i, 10) }}
          >
            <Card
              variant="interactive"
              onClick={() => {
                if (selectMode) {
                  onReview(item);
                } else if (isMT(item)) {
                  setExpandedMockId(expandedMockId === item.id ? null : item.id);
                } else {
                  onReview(item);
                }
              }}
              className={cn(
                "block",
                selectMode && isSelected && "ring-2 ring-primary border-primary",
              )}
            >
              <div className="flex items-start gap-3">
                {selectMode ? (
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[--radius-sm] border-2 transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface",
                    )}
                  >
                    {isSelected && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                  </span>
                ) : (
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
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {isMT(item) ? (
                      <>
                        Mock Test
                        <span className="ml-1 text-xs font-normal text-text-muted">
                          · {item.all_problems.length} question{item.all_problems.length !== 1 ? "s" : ""}
                        </span>
                      </>
                    ) : (
                      <MathText text={item.problem} />
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    {!isMT(item) && (
                      <span className="rounded-full bg-primary-bg px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        Learn
                      </span>
                    )}
                    {item.topic && (
                      <span className="rounded-full bg-surface border border-border px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                        {item.topic}
                      </span>
                    )}
                    <span>{formatRelativeDate(item.created_at)}</span>
                    <span className="text-[10px]">·</span>
                    <span>{formatDateTime(item.created_at)}</span>
                  </div>
                </div>
                <Badge variant={item.status === "completed" ? "success" : "muted"}>
                  {item.status}
                </Badge>
              </div>

              {/* Expandable question list for mock tests */}
              {isMT(item) && expandedMockId === item.id && (
                <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {item.all_problems.map((p, pi) => (
                    <div key={pi} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                        <span className="mr-1.5 text-text-muted">{pi + 1}.</span>
                        <MathText text={p} />
                      </div>
                      {onLearnProblem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onLearnProblem(p);
                          }}
                          className="flex-shrink-0 rounded-[--radius-sm] bg-primary-bg px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary hover:text-white"
                        >
                          Learn
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        );
      })}
      {hasMore && (
        <Button variant="ghost" className="w-full" onClick={onLoadMore} loading={loading}>
          Load More
        </Button>
      )}
    </div>
  );
}
