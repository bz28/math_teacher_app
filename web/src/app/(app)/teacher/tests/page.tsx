"use client";

import { ComingSoon } from "@/components/shared/coming-soon";

export default function TestsPage() {
  return (
    <ComingSoon
      title="Tests"
      description="Pick a topic and difficulty, AI generates tests with answer keys and variants to prevent cheating. Export as PDF."
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
      }
    />
  );
}
