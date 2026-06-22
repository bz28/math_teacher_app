// Role-aware landing decision. Kept as a pure function (no RN/Expo
// imports) so it's unit-testable without a render harness — App.tsx
// calls it after login and after token restore to pick the first screen.

export type Landing = "teacher-gate" | "solve";

/**
 * Where a freshly-authenticated user should land.
 *
 * Teachers and admins have no mobile surface yet — the dashboard lives
 * on the web — so they're routed to a graceful "use the web app" gate
 * instead of being dropped into the student study UI. Everyone else
 * (students, with or without a school) lands on the study screen.
 */
export function decideLanding(role: string | null | undefined): Landing {
  return role === "teacher" || role === "admin" ? "teacher-gate" : "solve";
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
