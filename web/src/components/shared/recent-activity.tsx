"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { session as sessionApi, type SessionHistoryItem } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";

interface RecentActivityProps {
  subject: string;
  activeTab: "learn" | "mock-test";
  onUseProblems: (problems: string[]) => void;
  maxQueueSize: number;
  currentQueueLength: number;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function filterForTab(
  items: SessionHistoryItem[],
  tab: "learn" | "mock-test",
): SessionHistoryItem[] {
  if (tab === "mock-test") {
    // Mock Test tab: show everything
    return items;
  }
  // Learn tab: exclude learn-mode sessions from the past hour
  const cutoff = Date.now() - ONE_HOUR_MS;
  return items.filter((item) => {
    if (item.mode === "mock_test") return true;
    // Learn/practice sessions: only show if older than 1 hour
    return new Date(item.created_at).getTime() < cutoff;
  });
}

export function RecentActivity({
  subject,
  activeTab,
  onUseProblems,
  maxQueueSize,
  currentQueueLength,
}: RecentActivityProps) {
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    sessionApi
      .history({ subject }, 10, 0)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [subject]);

  const filtered = filterForTab(items, activeTab).slice(0, 5);

  if (loading || filtered.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
        Recent Activity
      </h3>
      <div className="space-y-2">
        {filtered.map((item) => {
          const isMockTest = item.mode === "mock_test";
          const problemCount = item.all_problems.length;
          const queueFull = currentQueueLength >= maxQueueSize;

          const isExpanded = expandedId === item.id;

          return (
            <div
              key={item.id}
              className="rounded-[--radius-md] border border-border bg-surface px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {isMockTest ? (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="flex w-full items-center gap-1 text-left"
                    >
                      <p className="text-sm font-semibold text-text-primary">
                        Mock Test
                        <span className="ml-1 text-xs font-normal text-text-muted">
                          · {problemCount} question{problemCount !== 1 ? "s" : ""}
                        </span>
                      </p>
                      <svg
                        className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  ) : (
                    <div className="truncate text-sm font-medium text-text-primary">
                      <MathText text={item.problem} />
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                    {!isMockTest && (
                      <span className="rounded-full bg-primary-bg px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        Learn
                      </span>
                    )}
                    <span>{relativeTime(item.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => onUseProblems(item.all_problems)}
                  disabled={queueFull}
                  className="flex-shrink-0 rounded-[--radius-sm] p-1.5 text-primary transition-colors hover:bg-primary-bg disabled:opacity-30 disabled:cursor-not-allowed"
                  title={queueFull ? "Queue is full" : "Add to queue"}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>

              {/* Expandable problem preview for mock tests */}
              {isMockTest && isExpanded && (
                <div className="mt-2 space-y-1 border-t border-border pt-2">
                  {item.all_problems.slice(0, 3).map((p, pi) => (
                    <div key={pi} className="truncate text-xs text-text-muted">
                      <MathText text={`${pi + 1}. ${p}`} />
                    </div>
                  ))}
                  {item.all_problems.length > 3 && (
                    <p className="text-[11px] text-text-muted">
                      +{item.all_problems.length - 3} more
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Link
        href="/history"
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        More
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>
    </div>
  );
}
