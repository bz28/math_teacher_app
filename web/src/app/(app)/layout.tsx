"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppLayout } from "@/components/shared/app-layout";
import { PageTransition } from "@/components/shared/page-transition";

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppLayout>
        <PageTransition>{children}</PageTransition>
      </AppLayout>
    </AuthGuard>
  );
}
