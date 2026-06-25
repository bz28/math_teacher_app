"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { formatRelativeDate, cn } from "@/lib/utils";

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
  // Track which card's "Practice 5 similar" is busy so we can show a
  // per-card loading state and lock out the rest while one is launching.
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);

  const fetchWeakSpots = useCallback(async (sub: Subject) => {
    setLoading(true);
    try {
      const res = await weakSpotsApi.list(sub);
      setItems(res.items);
    } catch {
      // empty state handles it
      setItems([]);
    } finally {
      setLoading(false);
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

      <WeakSpotList
        loading={loading}
        items={items}
        generatingFor={generatingFor}
        onPractice={handlePractice}
      />
    </div>
  );
}

function Heading() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">
        Review
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        Problems where your attached work got flagged. Practice more like them.
      </p>
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

function WeakSpotList({
  loading,
  items,
  generatingFor,
  onPractice,
}: {
  loading: boolean;
  items: WeakSpotItem[];
  generatingFor: string | null;
  onPractice: (item: WeakSpotItem) => void;
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
        title="No weak spots yet"
        description="They'll show up here when work gets flagged."
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
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-text-muted">
          {formatRelativeDate(item.submitted_at)}
        </span>
        {item.issue_count > 1 && (
          <Badge variant="warning">flagged {item.issue_count}x</Badge>
        )}
      </div>

      <div className="text-sm font-medium text-text-primary">
        <MathText text={item.problem_text} />
      </div>

      {item.summary && (
        <p className="text-sm text-text-secondary">{item.summary}</p>
      )}

      <Button
        variant="secondary"
        className="w-full"
        loading={busy}
        disabled={anyBusy && !busy}
        onClick={onPractice}
      >
        Practice 5 similar
      </Button>
    </Card>
  );
}
