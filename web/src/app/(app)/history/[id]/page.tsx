"use client";

import { useState, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { session as sessionApi, type SessionResponse } from "@/lib/api";
import { useSessionStore } from "@/stores/learn";
import { usePracticeStore } from "@/stores/practice";
import { useEntitlementStore } from "@/stores/entitlements";
import { Card, Badge, Button } from "@/components/ui";
import { UpgradePrompt } from "@/components/shared/upgrade-prompt";
import { FREE_DAILY_SESSION_LIMIT } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { SkeletonStep } from "@/components/ui/skeleton";
import { cn, renderBold } from "@/lib/utils";

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

  // Clean up subject color theme from other pages
  useEffect(() => {
    document.documentElement.removeAttribute("data-subject");
  }, []);

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
                          {renderBold(step.description)}
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

      {/* Chat — ask questions about this session */}
      {isCompleted && (
        <SessionChat sessionId={id} />
      )}

      <div className="flex gap-3">
        {session.status === "active" && (
          <Button
            gradient
            onClick={() => {
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

function SessionChat({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  async function handleSend() {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setThinking(true);
    try {
      const response = await sessionApi.respond(sessionId, {
        student_response: q,
        request_advance: false,
      });
      setMessages((prev) => [...prev, { role: "assistant", text: response.feedback }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Something went wrong. Try again." }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <Card variant="flat" className="space-y-3">
      <p className="text-sm font-semibold text-text-primary">Have questions?</p>

      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "rounded-[--radius-md] px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-primary-bg text-primary ml-8"
                  : "bg-surface-raised text-text-primary mr-8",
              )}
            >
              {renderBold(msg.text)}
            </div>
          ))}
          {thinking && (
            <div className="bg-surface-raised text-text-muted rounded-[--radius-md] px-3 py-2 text-sm mr-8 animate-pulse">
              Thinking...
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="Ask about this problem..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={thinking}
          className="flex-1"
        />
        <Button
          onClick={handleSend}
          loading={thinking}
          disabled={!input.trim()}
          size="sm"
        >
          Ask
        </Button>
      </div>
    </Card>
  );
}

function PracticeSimilarButton({ problem, subject }: { problem: string; subject: string }) {
  const [loading, setLoading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const router = useRouter();
  const { isPro, dailySessionsUsed, dailySessionsLimit } = useEntitlementStore();
  const remaining = isPro ? Infinity : Math.max(0, dailySessionsLimit - dailySessionsUsed);

  return (
    <>
      <Button
        variant="secondary"
        loading={loading}
        onClick={async () => {
          if (!isPro && remaining <= 0) {
            setShowUpgrade(true);
            return;
          }
          setLoading(true);
          try {
            useSessionStore.getState().setSubject(subject as "math" | "chemistry");
            await usePracticeStore.getState().startPracticeBatch(problem, 1, subject as "math" | "chemistry");
            router.push("/practice");
          } finally {
            setLoading(false);
          }
        }}
      >
        Practice Similar Problem
      </Button>
      <UpgradePrompt
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        entitlement="create_session"
        message={`You've used all ${FREE_DAILY_SESSION_LIMIT} problems for today. Upgrade to Pro for unlimited access.`}
      />
    </>
  );
}
