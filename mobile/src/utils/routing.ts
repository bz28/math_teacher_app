// Role-aware landing decision. Kept as a pure function (no RN/Expo
// imports) so it's unit-testable without a render harness — App.tsx
// calls it after login and after token restore to pick the first screen.

export type Landing = "teacher-gate" | "school-home";

/**
 * Where a freshly-authenticated user should land.
 *
 * - Teachers/admins -> the web-app gate (no mobile dashboard).
 * - Every student -> their classroom home (assignments, grades), which
 *   offers "Join a class" until they're enrolled. Veradic is schools-only:
 *   the personal study screens are hidden, never a landing.
 */
export function decideLanding(role: string | null | undefined): Landing {
  if (role === "teacher" || role === "admin") return "teacher-gate";
  return "school-home";
}

/**
 * True when an `/auth/login` response is an MFA challenge rather than a
 * token grant (no access token issued yet). MFA is teacher/admin-only,
 * so on mobile — which has no MFA code-entry flow — this reliably means
 * "a teacher tried to sign in" and we route them to the same gate
 * instead of crashing on undefined tokens.
 */
export function isMfaChallenge(resp: { access_token?: string | null }): boolean {
  return !resp.access_token;
}
