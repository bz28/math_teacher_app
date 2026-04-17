"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { session as sessionApi, type SessionHistoryItem } from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { formatRelativeDate } from "@/lib/utils";

interface RecentActivityProps {
  subject: string;
  onUseProblems: (problems: string[]) => void;
  maxQueueSize: number;
  currentQueueLength: number;
}


export function RecentActivity({
  subject,
  onUseProblems,
  maxQueueSize,
  currentQueueLength,
}: RecentActivityProps) {
  const [items, setItems] = useState<SessionHistoryItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionApi
      .history({ subject }, 10, 0)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => { cancelled = true; };
  }, [subject]);

  if (!items || items.length === 0) return null;

  const filtered = items.slice(0, 5);

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
                    <>
                      <p className="text-sm font-semibold text-text-primary">
                        Mock Test
                        <span className="ml-1 text-xs font-normal text-text-muted">
                          · {problemCount} question{problemCount !== 1 ? "s" : ""}
                        </span>
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span>{formatRelativeDate(item.created_at)}</span>
                        <span className="text-[10px]">·</span>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          className="font-semibold text-primary hover:underline"
                        >
                          {isExpanded ? "Hide" : "View"} questions
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="truncate text-sm font-medium text-text-primary">
                        <MathText text={item.problem} />
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span className="rounded-full bg-primary-bg px-1.5 py-0.5 text-[10px] font-bold text-primary">
                          Learn
                        </span>
                        <span>{formatRelativeDate(item.created_at)}</span>
                      </div>
                    </>
                  )}
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
                  {item.all_problems.map((p, pi) => (
                    <p key={pi} className="truncate text-xs text-text-secondary">
                      <span className="text-text-muted">{pi + 1}.</span> {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Link
        href={`/history?select=true&subject=${subject}`}
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
