"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

/**
 * Role guard for the school-student section. Sends users who aren't
 * school-affiliated students back to the personal home. The auth check
 * itself is done one level up by AuthGuard in (app)/layout.tsx, so we
 * only need to enforce the role+school_id check here.
 */
export default function SchoolStudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuthStore();

  useEffect(() => {
    if (loading || !user) return;
    if (user.role !== "student" || !user.school_id) {
      router.replace("/home");
    }
  }, [user, loading, router]);

  if (loading || !user || user.role !== "student" || !user.school_id) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
