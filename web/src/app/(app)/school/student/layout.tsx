"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { exitPreviewMode, isInPreviewMode } from "@/lib/api";

/**
 * Role guard for the school-student section. Sends users who aren't
 * school-affiliated students back to the personal home.
 *
 * When the teacher is in preview mode (shadow student), a sticky banner
 * renders at the top with a "Back to teacher view" button.
 */
export default function SchoolStudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, loading, loadUser } = useAuthStore();
  const preview = typeof window !== "undefined" && isInPreviewMode();

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

  return (
    <>
      {preview && (
        <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm font-medium text-white">
          <span>Previewing as student</span>
          <button
            onClick={async () => {
              exitPreviewMode();
              await loadUser();
              router.push("/school/teacher");
            }}
            className="rounded-full border border-white/30 px-3 py-0.5 text-xs font-bold hover:bg-white/20"
          >
            Back to teacher view
          </button>
        </div>
      )}
      {children}
    </>
  );
}
