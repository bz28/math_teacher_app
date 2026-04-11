"use client";

/**
 * SubjectTheme — keeps <html data-subject="..."> in sync with the active
 * learn-session subject on subject-scoped routes (Solve / Session / Mock /
 * Practice). On cross-subject routes (Home / History / Library / Account)
 * the attribute is cleared so the UI falls back to the default brand color.
 *
 * Renders nothing. Mount once inside the (app) layout.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSessionStore } from "@/stores/learn";

const SUBJECT_ROUTES = ["/learn", "/mock-test", "/practice"];

export function SubjectTheme() {
  const pathname = usePathname();
  const subject = useSessionStore((s) => s.subject);

  useEffect(() => {
    const scoped = SUBJECT_ROUTES.some((r) => pathname.startsWith(r));
    const root = document.documentElement;
    if (scoped && subject) {
      root.setAttribute("data-subject", subject);
    } else {
      root.removeAttribute("data-subject");
    }
  }, [pathname, subject]);

  return null;
}
