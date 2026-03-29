"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { AppLayout } from "@/components/shared/app-layout";

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppLayout>{children}</AppLayout>
    </AuthGuard>
  );
}
