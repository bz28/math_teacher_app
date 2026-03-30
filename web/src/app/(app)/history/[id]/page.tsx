"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { session as sessionApi, type SessionResponse } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { Card, Badge, Button } from "@/components/ui";
import { SkeletonStep } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function SessionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const subject = searchParams.get("subject") ?? "math";

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await sessionApi.get(id);
        setSession(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SkeletonStep />
        <SkeletonStep />
        <SkeletonStep />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-2xl text-center py-12">
        <p className="text-error">{error ?? "Session not found"}</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push("/history")}
        >
          Back to History
        </Button>
      </div>
    );
  }

  const isCompleted = session.status === "completed";
  const reachedStep = Math.max(1, session.current_step);
  const statusLabel = isCompleted
    ? "Completed"
    : session.status === "abandoned"
      ? "Ended Early"
      : "In Progress";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <button
          onClick={() => router.push("/history")}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-text-muted hover:text-primary transition-colors"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to History
        </button>

        <h1 className="text-xl font-extrabold text-text-primary">
          {session.problem}
        </h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={isCompleted ? "success" : "muted"}>
            {statusLabel}
          </Badge>
          <span className="text-xs text-text-muted">
            {reachedStep}/{session.total_steps} steps
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-border-light overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light"
            style={{
              width: `${(reachedStep / session.total_steps) * 100}%`,
            }}
          />
        </div>
      </motion.div>

      {/* Steps */}
      <div className="space-y-3">
        {session.steps.map((step, i) => {
          const stepNum = i + 1;
          const isReached = isCompleted || stepNum <= reachedStep;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
            >
              <Card
                variant="flat"
                className={cn(!isReached && "opacity-50")}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isReached
                        ? "bg-primary text-white"
                        : "bg-border text-text-muted",
                    )}
                  >
                    {stepNum}
                  </span>
                  <div className="flex-1">
                    {isReached ? (
                      <>
                        {step.title && (
                          <p className="text-xs font-bold text-primary">{step.title}</p>
                        )}
                        <p className="text-sm font-medium text-text-primary">
                          {step.description}
                        </p>
                        {step.final_answer && (
                          <p className="mt-1 text-sm text-text-secondary">
                            &rarr; {step.final_answer}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm italic text-text-muted">
                        Not yet reached
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="flex gap-3">
        {session.status === "active" && (
          <Button
            gradient
            onClick={() => {
              // Resume by navigating to session page — the session ID is already known
              router.push(`/learn/session?subject=${subject}&resume=${id}`);
            }}
          >
            Resume Session
          </Button>
        )}
        <PracticeSimilarButton problem={session.problem} subject={subject} />
      </div>
    </div>
  );
}

function PracticeSimilarButton({ problem, subject }: { problem: string; subject: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  return (
    <Button
      variant="secondary"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const store = useSessionStore.getState();
          store.setSubject(subject as "math" | "chemistry");
          await store.startPracticeBatch(problem, 1);
          router.push("/practice");
        } finally {
          setLoading(false);
        }
      }}
    >
      Practice Similar Problem
    </Button>
  );
}
