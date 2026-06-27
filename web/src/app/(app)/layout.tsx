"use client";

import { useCallback } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppLayout } from "@/components/shared/app-layout";
import { PageTransition } from "@/components/shared/page-transition";
import { TourProvider, type TourPersona } from "@/components/tour";
import { useAuthStore } from "@/stores/auth";

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const markTourSeen = useAuthStore((s) => s.markTourSeen);
  // Stabilize the callback so TourProvider's context value (and the
  // `tour` object pages read) keeps a steady identity across re-renders.
  // An inline closure here churns that identity every render, which can
  // cancel the course page's rAF auto-start mid-flight — the tour then
  // silently never mounts. markTourSeen is a stable zustand action.
  const handleTourComplete = useCallback(
    (persona: TourPersona) => void markTourSeen(persona),
    [markTourSeen],
  );
  return (
    <AuthGuard>
      {/* Field Guide onboarding tour engine — persona step-lists live in
          components/tour/tours.ts. Dismissal (skip/finish) persists via
          markTourSeen so a persona's tour auto-mounts only once. */}
      <TourProvider onComplete={handleTourComplete}>
        <AppLayout>
          <PageTransition>{children}</PageTransition>
        </AppLayout>
      </TourProvider>
    </AuthGuard>
  );
}
