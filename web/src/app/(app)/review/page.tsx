"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  weakSpots as weakSpotsApi,
  EntitlementError,
  type WeakSpotItem,
} from "@/lib/api";
import { usePracticeStore } from "@/stores/practice";
import { useSessionStore, type Subject } from "@/stores/learn";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { SkeletonCard } from "@/components/ui/skeleton";
import { MathText } from "@/components/shared/math-text";
import { PageMasthead } from "@/components/shared/page-masthead";
import { SubjectTabs } from "@/components/shared/subject-tabs";
import { formatRelativeDate } from "@/lib/utils";

export default function ReviewPage() {
  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

  return <PersonalReview />;
}

function PersonalReview() {
  const router = useRouter();
  const { setSubject } = useSessionStore();
  const practiceFlaggedProblems = usePracticeStore((s) => s.practiceFlaggedProblems);

  const [subject, setLocalSubject] = useState<Subject>("math");
  const [items, setItems] = useState<WeakSpotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Track which card's practice button is busy so we can show a per-card
  // loading state and lock out the rest while one is launching.
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  // Monotonic request id: ignore any response that a newer fetch superseded
  // (switching subject tabs fast would otherwise let a stale response win).
  const reqIdRef = useRef(0);

  const fetchWeakSpots = useCallback(async (sub: Subject) => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const res = await weakSpotsApi.list(sub);
      if (reqId !== reqIdRef.current) return;
      setItems(res.items);
    } catch {
      if (reqId !== reqIdRef.current) return;
      setError(true);
      setItems([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeakSpots(subject);
  }, [subject, fetchWeakSpots]);

  async function handlePractice(item: WeakSpotItem) {
    if (generatingFor) return;
    setGeneratingFor(item.problem_text);
    try {
      setSubject(subject);
      await practiceFlaggedProblems([item.problem_text], subject);
      router.push("/practice");
    } catch (err) {
      if (err instanceof EntitlementError) {
        router.push("/pricing");
      }
    } finally {
      setGeneratingFor(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-12 pb-20">
      <PageMasthead
        eyebrow="REVIEW"
        title={
          <>
            Your <span className="text-primary">weak spots</span>
          </>
        }
        subtitle="Problems where your work got flagged. Practice more like them."
      />

      <SubjectTabs
        active={subject}
        onSelect={(key) => {
          setLocalSubject(key as Subject);
          setItems([]);
        }}
        tabs={[
          { key: "math", label: "Mathematics" },
          { key: "physics", label: "Physics" },
          { key: "chemistry", label: "Chemistry" },
        ]}
      />

      <WeakSpotList
        loading={loading}
        error={error}
        items={items}
        generatingFor={generatingFor}
        onPractice={handlePractice}
        onRetry={() => fetchWeakSpots(subject)}
      />
    </div>
  );
}

function WeakSpotList({
  loading,
  items,
  generatingFor,
  onPractice,
  error,
  onRetry,
}: {
  loading: boolean;
  items: WeakSpotItem[];
  generatingFor: string | null;
  onPractice: (item: WeakSpotItem) => void;
  error: boolean;
  onRetry: () => void;
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

  if (error) {
    return (
      <EmptyState
        title="Couldn't load your review"
        description="Something went wrong fetching your flagged problems."
        action={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No weak spots yet"
        description="They'll show up here when work gets flagged. In the meantime, get some reps in."
        action={
          <Link
            href="/learn"
            className="inline-flex items-center justify-center rounded-[--radius-md] border border-border bg-transparent px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-text-primary"
          >
            Practice a few problems →
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <motion.div
          key={`${item.problem_text}-${item.submitted_at}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 * i }}
        >
          <WeakSpotCard
            item={item}
            busy={generatingFor === item.problem_text}
            anyBusy={generatingFor !== null}
            onPractice={() => onPractice(item)}
          />
        </motion.div>
      ))}
    </div>
  );
}

function WeakSpotCard({
  item,
  busy,
  anyBusy,
  onPractice,
}: {
  item: WeakSpotItem;
  busy: boolean;
  anyBusy: boolean;
  onPractice: () => void;
}) {
  return (
    <Card className="relative space-y-3.5 overflow-hidden pl-6">
      <span className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full bg-primary/40" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">
          {formatRelativeDate(item.submitted_at)}
        </span>
        {item.issue_count > 1 && (
          <Badge variant="warning">flagged {item.issue_count}x</Badge>
        )}
      </div>

      <div className="text-[15px] leading-relaxed text-text-primary">
        <MathText text={item.problem_text} />
      </div>

      {item.summary && (
        <p className="text-sm leading-relaxed text-text-secondary">{item.summary}</p>
      )}

      <Button
        variant="secondary"
        className="w-full"
        loading={busy}
        disabled={anyBusy && !busy}
        onClick={onPractice}
      >
        Practice a similar problem
      </Button>
    </Card>
  );
}
