"use client";

import { useState, useRef } from "react";
import { work as workApi, type DiagnosisResult } from "@/lib/api";
import { Card, Badge } from "@/components/ui";
import { statusToBadgeVariant } from "@/components/ui/badge";
import { cn, fileToBase64 } from "@/lib/utils";

interface WorkDiagnosisProps {
  problemText: string;
  userAnswer: string;
  userWasCorrect: boolean;
  subject: string;
}

export function WorkDiagnosis({
  problemText,
  userAnswer,
  userWasCorrect,
  subject,
}: WorkDiagnosisProps) {
  const [submitting, setSubmitting] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setError("Please upload an image under 5MB.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const res = await workApi.submit({
        image_base64: base64,
        problem_text: problemText,
        user_answer: userAnswer,
        user_was_correct: userWasCorrect,
        subject,
      });
      setDiagnosis(res.diagnosis);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (diagnosis) {
    return (
      <Card variant="flat" className="space-y-4">
        <h3 className="text-sm font-bold text-text-primary">
          Work Diagnosis
        </h3>

        {/* Steps */}
        <div className="space-y-2">
          {diagnosis.steps.map((step, i) => (
            <div
              key={i}
              className="rounded-[--radius-md] border border-border-light bg-surface p-3 space-y-1"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-text-primary">
                  {step.step_description}
                </p>
                <Badge variant={statusToBadgeVariant(step.status)}>
                  {step.status}
                </Badge>
              </div>
              {step.student_work && (
                <p className="text-xs text-text-secondary">
                  Your work: {step.student_work}
                </p>
              )}
              {step.feedback && (
                <p className="text-xs text-text-muted">{step.feedback}</p>
              )}
            </div>
          ))}
        </div>

        {/* Summary */}
        <div
          className={cn(
            "rounded-[--radius-md] p-3 text-sm",
            diagnosis.has_issues
              ? "bg-warning-bg text-warning-dark"
              : "bg-success-light text-success",
          )}
        >
          {diagnosis.overall_feedback}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={submitting}
        className="flex w-full items-center gap-2 rounded-[--radius-md] border border-dashed border-border px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
      >
        {submitting ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Analyzing your work...
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload your handwritten work for diagnosis
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
        className="hidden"
      />
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
