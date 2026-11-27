/**
 * Does the page at this URL follow the rail's school scope?
 *
 *   "school"   — its data belongs to schools and it sends `school_id`
 *                (Teacher reports, LLM calls, Users, Audit log, the
 *                accuracy pages).
 *   "platform" — its data belongs to no school, so the scope does not
 *                apply: the Schools directory and Leads (the business
 *                side) and the Admins preset of Users (admins have no school).
 *   null       — a page about ONE thing: a school, a teacher, a
 *                submission. Its subject is fixed by the URL.
 *
 * One table, read by both the rail's scope line and the switcher, so
 * the claim "this page is scoped" cannot drift from where it is shown.
 * When a page starts or stops sending `school_id`, change it here.
 */
export type PageScope = "school" | "platform" | null;

const SCHOOL_SCOPED = [
  "/reports",
  "/llm-calls",
  "/users",
  "/audit-logs",
  "/grading-quality",
  "/extraction-quality",
];

const PLATFORM = ["/schools", "/leads"];

export function pageScope(pathname: string, search: string): PageScope {
  const params = new URLSearchParams(search);
  if (pathname === "/users" && params.get("role") === "admin") return "platform";
  // LLM calls filtered to one user / submission / session is about that
  // one thing, and the page drops the school scope for it (LLMCalls.tsx).
  if (pathname === "/llm-calls" && ["user", "submission", "session"].some((k) => params.get(k))) {
    return null;
  }
  // Exact matches only: /reports/:id, /leads/:id and /schools/:id are
  // single-thing pages, not the lists.
  if (SCHOOL_SCOPED.includes(pathname)) return "school";
  if (PLATFORM.includes(pathname)) return "platform";
  if (pathname.startsWith("/leads/")) return "platform";
  return null;
}

/**
 * Name plus place. School names repeat heavily in the real data — the
 * current list holds fourteen "Lincoln High School" — so a name-only
 * label is fourteen identical rows with nothing to choose between them.
 */
export function schoolLabel(s: {
  name: string;
  city: string | null;
  state: string | null;
}): string {
  const where = [s.city, s.state].filter(Boolean).join(", ");
  return where ? `${s.name} — ${where}` : s.name;
}
