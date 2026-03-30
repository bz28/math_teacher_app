"use client";

import type { DiagnosisResult } from "@/lib/api";

interface DiagnosisTeaserProps {
  diagnosis: DiagnosisResult | null;
  analyzing?: boolean;
}

export function DiagnosisTeaser({ diagnosis, analyzing }: DiagnosisTeaserProps) {
  if (diagnosis) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <svg
          className={`h-3.5 w-3.5 flex-shrink-0 ${diagnosis.has_issues ? "text-warning-dark" : "text-success"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <p
          className={`text-xs italic ${diagnosis.has_issues ? "text-warning-dark" : "text-success"}`}
        >
          {diagnosis.summary}
        </p>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent" />
        <p className="text-xs text-text-muted">Analyzing work...</p>
      </div>
    );
  }

  return null;
}
