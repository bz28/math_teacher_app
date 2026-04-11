"use client";

import type { DiagnosisResult } from "@/lib/api";
import { CameraIcon } from "./icons";

interface DiagnosisTeaserProps {
  diagnosis: DiagnosisResult | null;
  analyzing?: boolean;
}

export function DiagnosisTeaser({ diagnosis, analyzing }: DiagnosisTeaserProps) {
  if (diagnosis) {
    const tone = diagnosis.has_issues ? "text-warning-dark" : "text-success";
    return (
      <div className="mt-1 flex items-center gap-2">
        <CameraIcon className={`h-3.5 w-3.5 flex-shrink-0 ${tone}`} />
        <p className={`text-xs italic ${tone}`}>{diagnosis.summary}</p>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <div
          role="status"
          aria-label="Analyzing work"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent"
        />
        <p className="text-xs text-text-muted">Analyzing work...</p>
      </div>
    );
  }

  return null;
}
