"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";

/**
 * Role guard for the school-student section. Sends users who aren't
 * school-affiliated students (or shadow previews) back to the personal home.
 *
 * The "Previewing as student / Back to teacher view" banner used to live
 * here but is now hoisted to the outer SchoolStudentLayout shell so a
 * previewing teacher keeps the exit affordance on shared routes like
 * /account (which doesn't render this inner Next layout).
 */
export default function SchoolStudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading } = useAuthStore();

  // Shadow-student previews (Preview as student) get school_id=null when
  // the owning teacher is solo (no school). Admit them anyway — the
  // dashboard is enrollment-driven and the outer shell's preview banner
  // gives them a way back.
  const allowed =
    !!user &&
    user.role === "student" &&
    (!!user.school_id || user.is_preview);

  useEffect(() => {
    if (loading || !user) return;
    if (!allowed) {
      router.replace("/home");
    }
  }, [user, loading, allowed, router]);

  if (loading || !allowed) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
