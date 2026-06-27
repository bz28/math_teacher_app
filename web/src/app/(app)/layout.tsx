"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppLayout } from "@/components/shared/app-layout";
import { PageTransition } from "@/components/shared/page-transition";
import { TourProvider } from "@/components/tour";
import { useAuthStore } from "@/stores/auth";

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const markTourSeen = useAuthStore((s) => s.markTourSeen);
  return (
    <AuthGuard>
      {/* Field Guide onboarding tour engine — persona step-lists live in
          components/tour/tours.ts. Dismissal (skip/finish) persists via
          markTourSeen so a persona's tour auto-mounts only once. */}
      <TourProvider onComplete={(persona) => void markTourSeen(persona)}>
        <AppLayout>
          <PageTransition>{children}</PageTransition>
        </AppLayout>
      </TourProvider>
    </AuthGuard>
  );
}
