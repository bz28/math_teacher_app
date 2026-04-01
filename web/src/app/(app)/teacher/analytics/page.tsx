"use client";

import { ComingSoon } from "@/components/shared/coming-soon";

export default function AnalyticsPage() {
  return (
    <ComingSoon
      title="Analytics"
      description="See which students are struggling and on what topics. Traffic-light system per student with class-wide struggle patterns."
      icon={
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10M12 20V4M6 20v-6" />
        </svg>
      }
    />
  );
}
