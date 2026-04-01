"use client";

import { ComingSoon } from "@/components/shared/coming-soon";

export default function HomeworkPage() {
  return (
    <ComingSoon
      title="Homework"
      description="Create assignments, students submit photos of their work, AI grades step-by-step. You review and override where needed."
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
      }
    />
  );
}
