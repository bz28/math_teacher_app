"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { session as sessionApi, type SessionResponse } from "@/lib/api";
import { Card, Badge, Button } from "@/components/ui";
import { SkeletonStep } from "@/components/ui/skeleton";

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <button
          onClick={() => router.push("/history")}
          className="mb-4 flex items-center gap-1 text-sm font-medium text-text-muted hover:text-primary transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to History
        </button>

        <h1 className="text-xl font-extrabold text-text-primary">
          {session.problem}
        </h1>
        <div className="mt-2 flex gap-2">
          <Badge variant={session.status === "completed" ? "success" : "muted"}>
            {session.status}
          </Badge>
          <Badge variant="info">
            {session.total_steps} steps
          </Badge>
        </div>
      </motion.div>

      {/* Steps (read-only) */}
      <div className="space-y-4">
        {session.steps.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <Card variant="flat" className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="text-sm font-bold text-text-primary">
                  {step.description}
                </h3>
              </div>
              {step.final_answer && (
                <p className="ml-10 text-sm text-text-secondary">
                  Answer: <strong>{step.final_answer}</strong>
                </p>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      <Button
        variant="secondary"
        onClick={() => router.push(`/learn?subject=${subject}`)}
      >
        Practice Similar
      </Button>
    </div>
  );
}
