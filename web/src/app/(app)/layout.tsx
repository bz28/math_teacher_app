"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppLayout } from "@/components/shared/app-layout";
import { PageTransition } from "@/components/shared/page-transition";
import { SubjectTheme } from "@/components/shared/subject-theme";

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SubjectTheme />
      <AppLayout>
        <PageTransition>{children}</PageTransition>
      </AppLayout>
    </AuthGuard>
  );
}
