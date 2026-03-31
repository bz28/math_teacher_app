"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { session as sessionApi, type SessionHistoryItem } from "@/lib/api";
import { useSessionStore, type Subject } from "@/stores/session";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { SkeletonCard } from "@/components/ui/skeleton";
import { formatRelativeDate, cn } from "@/lib/utils";

export default function HistoryPage() {
  const router = useRouter();
  const { setSubject } = useSessionStore();

  const [subject, setLocalSubject] = useState<Subject>("math");

  // Clean up subject color theme from other pages
  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const fetchHistory = useCallback(
    async (sub: Subject, offset = 0) => {
      setLoading(true);
      try {
        const res = await sessionApi.history(sub, 20, offset);
        if (offset === 0) {
          setItems(res.items);
        } else {
          setItems((prev) => [...prev, ...res.items]);
        }
        setHasMore(res.has_more);
      } catch {
        // Ignore — empty state handles it
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchHistory(subject);
  }, [subject, fetchHistory]);

  function handleSubjectChange(sub: Subject) {
    setLocalSubject(sub);
    setItems([]);
  }

  async function handleReview(item: SessionHistoryItem) {
    setSubject(subject);
    router.push(`/history/${item.id}?subject=${subject}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
          Session History
        </h1>
      </motion.div>

      {/* Subject tabs */}
      <div className="flex gap-2">
        {(["math", "chemistry"] as const).map((sub) => (
          <button
            key={sub}
            onClick={() => handleSubjectChange(sub)}
            className={cn(
              "rounded-[--radius-pill] px-4 py-2 text-sm font-semibold transition-colors",
              subject === sub
                ? "bg-primary text-white"
                : "bg-primary-bg text-primary hover:bg-primary/10",
            )}
          >
            {sub === "math" ? "Mathematics" : "Chemistry"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading && items.length === 0 ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Start learning to see your history here"
          action={
            <Button
              variant="secondary"
              onClick={() => router.push(`/learn?subject=${subject}`)}
            >
              Start Learning
            </Button>
          }
        />
      ) : (
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
                onClick={() => handleReview(item)}
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
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
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
                <Badge
                  variant={item.status === "completed" ? "success" : "muted"}
                >
                  {item.status}
                </Badge>
              </Card>
            </motion.div>
          ))}

          {hasMore && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => fetchHistory(subject, items.length)}
              loading={loading}
            >
              Load More
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
