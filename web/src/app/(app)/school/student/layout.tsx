"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homePathFor } from "@/lib/home-path";
import { useAuthStore } from "@/stores/auth";

/**
 * Role guard for the school-student section. Sends non-students to their
 * own portal.
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

  // Every student belongs here (schools-only), including one not yet in a
  // class — the dashboard is enrollment-driven and shows a join-a-class
  // view until they enroll — and a solo teacher's preview shadow.
  const allowed = !!user && user.role === "student";

  useEffect(() => {
    if (loading || !user) return;
    if (!allowed) {
      router.replace(homePathFor(user.role));
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
