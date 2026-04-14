# School portal cleanup — round 2

Follow-up to `fix/school-portal-cleanup` (PR #217, merged). Four things:

1. History tab for school students should be organized by their enrolled courses, not generic subjects.
2. "Start Learning" / `/learn` path should not be reachable from the school student UI — keep them inside their class-scoped experience.
3. Leftover from review: close the backslash bypass in the login `?redirect=` check.
4. Leftover from review: HTML-escape invite email content (section invite + teacher invite) so a teacher or admin can't inject links into outbound email.

Branch: `fix/school-portal-round-2`.

## 1. History tab — courses instead of subjects

**Current state:**
- `web/src/app/(app)/history/page.tsx` renders a row of subject tabs (math, physics, chemistry) and calls `GET /session/history?subject=X`.
- The session model already stores `section_id` (nullable), and the session-create endpoint populates it when the student launches a session from a course card.
- `GET /auth/enrolled-courses` already returns the student's courses with `section_id` per course.

**Goal:**
- For a school-linked student (`user.school_id != null`): replace the subject tabs with a tab per enrolled course. Each tab shows the sessions that belong to that course's section. **No "All" tab** — school students only see per-course history. Pre-enrollment personal sessions (section_id = null) are not visible to school students at all.
- For a personal student: keep the existing subject tabs (no behavior change).

**Backend changes:**
- Add optional `section_id` query param to `GET /session/history`. If provided, filter sessions by `Session.section_id == section_id` (and still scope to the caller's `user_id`).
- Keep the existing `subject` param. The two are independent — in practice the frontend sends one or the other.

**Frontend changes:**
- `history/page.tsx` branches on `user.school_id`:
  - School student: fetch enrolled courses, render one tab per course (no "All" tab). Default tab is the first course. Selecting a tab calls `/session/history?section_id=<id>`. If the student has zero enrollments, show an empty state: "No classes yet. Ask your teacher for an invite code."
  - Personal student: current behavior unchanged.
- No changes to the session card itself — each row still shows title, date, etc.

**Out of scope:**
- Showing course name on each session card (nice-to-have, skip for v1; the active tab already tells you which course you're in).
- Surfacing pre-enrollment personal sessions for school students — deliberately hidden.

## 2. Block `/learn` entry for school students

**Current state:**
- Mobile tab bar (`components/shared/app-layout.tsx`) shows a "Learn" button that links to `/learn` for everyone.
- The home page redirects school students to `/school/student`, but `/learn` has no gate — a school student can URL-type their way in.
- From `/learn` they can start a personal, free-form session that isn't attached to any section.

**Goal:**
- School-linked students should never be able to reach `/learn`. Their only session-starting paths are course/section-scoped.

**Changes:**
- `app-layout.tsx`: hide the Learn tab + any other non-school-portal nav when `user.school_id` is set. (The navigation scaffold likely has two modes already — verify and use that.)
- `/learn` page: on mount, if `user.school_id`, `router.replace("/school/student")`. Belt and suspenders — stops URL-typing and deep-linked CTAs.
- Do **not** change session creation on the backend. A school student could still legitimately create a session via the school-student flow; the guard is at the navigation layer only.

**Consistency note:**
- `/home` already redirects school students → `/school/student`. Same pattern applied to `/learn` keeps behavior uniform.

## 3. Backslash bypass in login redirect

**Current state:** `login/page.tsx:57`:
```ts
redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : ...
```
Chrome normalizes `\` to `/` in HTTP URL paths, so `/\evil.com` is a bypass.

**Fix:** parse the redirect as a URL against the current origin and require same origin.
```ts
function safeRedirect(r: string | null): string | null {
  if (!r) return null;
  try {
    const u = new URL(r, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}
```
Drop the string-prefix check entirely — `URL` handles all the weird cases (backslashes, encoded slashes, control chars, authority weirdness) for us.

## 4. HTML-escape invite email content

**Current state:**
- `api/routes/teacher_sections.py:_send_invite_email` interpolates `teacher_name`, `course_name`, `section_name` into HTML without escaping.
- `api/routes/admin_schools.py:invite_teacher` has the same pattern with `school.name`.

**Fix:** run each value through `html.escape(x, quote=True)` from the stdlib before interpolation. Keeps the existing template shape, no new deps, applies to both callsites.

Subject lines can stay as-is (email clients treat them as plain text).

## Commits

Rough ordering — each commit stands on its own and passes CI.

1. `fix(web): use URL parsing for login redirect allowlist`
2. `fix(api): html-escape user-controlled fields in invite emails`
3. `feat(api): accept section_id filter on session history`
4. `feat(web): history tab by enrolled course for school students`
5. `fix(web): hide /learn and related CTAs for school students`

(3) and (4) are a pair — (3) alone is harmless; (4) relies on (3).

## Test plan

- **Backslash redirect:** `/login?redirect=/\evil.com` → login succeeds and lands on the default dashboard, not evil.com.
- **Invite email HTML escape:** create a course named `<b>X</b>` and a section named `<a href='#'>Y</a>`, invite a fresh email. Raw HTML source in the email shows the escaped text, not rendered tags.
- **History by course:** school student with 2 enrolled courses sees 2 course tabs + "All". Selecting a course tab shows only sessions from that course's section.
- **History fallback:** personal student sees unchanged subject tabs.
- **Learn blocked:** school student visits `/learn` directly → bounced to `/school/student`. Mobile tab bar doesn't show a Learn button for them.

## Out of scope

- Moving shell-account cleanup for preview students (separate concern).
- Reordering tabs by recent activity.
- Surfacing course name on each history row.
