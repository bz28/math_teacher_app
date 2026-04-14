# Section Invites (Pending-Invite + Email Flow)

## Problem

Today, a teacher adding a student to a section by email fails with "No user found with that email" if the student hasn't signed up yet (`api/routes/teacher_sections.py:141-142`). Teachers expect to invite students from a roster regardless of whether they've registered. There's no pending state, no email, no claim flow.

## Goal

Teacher enters an email → backend creates a pending `section_invite`, sends an email with a signup/claim link. On signup (or login, if the user already exists), the invite is claimed and the student is auto-enrolled in the section.

Mirrors the existing `teacher_invite` → `auth.py /register` pattern for consistency.

## Scope

- Backend: new model, migration, routes (create / list / revoke / claim), email template, wire into signup + a new "claim for existing user" endpoint.
- Frontend: replace the `addStudent` call with `inviteStudent`, show pending invites in the section card with revoke + resend.
- Keep the existing `addStudent` endpoint for now (teachers may want to add an already-enrolled student directly) — or remove it and unify. Recommendation: **remove** `addStudent`; invites always go through the invite flow, which auto-handles the "user already exists" case by instantly enrolling them (no email sent) or by sending a "you've been added" notice. Simpler model.

## Data model

**New table: `section_invites`** (mirrors `teacher_invites`)

| Column        | Type                      | Notes                                         |
|---------------|---------------------------|-----------------------------------------------|
| id            | UUID PK                   |                                               |
| section_id    | UUID FK → sections        | indexed, ondelete CASCADE                     |
| email         | String 255                | indexed, stored lowercased                    |
| invited_by    | UUID FK → users           | nullable, ondelete SET NULL                   |
| token         | String 255                | unique                                        |
| status        | String 20                 | default "pending"; pending/accepted/expired/revoked |
| expires_at    | DateTime TZ               | 14 days (reuse `INVITE_EXPIRY_DAYS`)          |
| created_at    | DateTime TZ               | server_default func.now()                     |

Unique partial index on `(section_id, email)` where `status = 'pending'` to prevent duplicate pending invites. (Existing accepted invites shouldn't block a future re-invite after a student leaves a section.)

Migration: `a1000018_add_section_invites.py` (next in sequence after `z1000017`).

## Backend routes

All under teacher auth + course ownership guard (same pattern as existing `teacher_sections.py`).

1. **`POST /teacher/courses/{course_id}/sections/{section_id}/invites`** — body `{ email }`
   - Normalize email lowercased.
   - If user already exists with that email:
     - If already enrolled → 409 "Already in section".
     - Else → create enrollment directly, return `{ status: "enrolled", student_id }`. No invite, no email. (Optional: send a courtesy "you were added to X" email — **skip for v1**.)
   - If no user:
     - If pending invite exists → return it (idempotent resend or 409? Let's be idempotent and refresh token/expiry + resend email).
     - Else → create `SectionInvite`, send email, return `{ status: "invited", invite_id }`.

2. **`GET /teacher/courses/{course_id}/sections/{section_id}/invites`** — list pending invites (for display in UI).

3. **`DELETE /teacher/courses/{course_id}/sections/{section_id}/invites/{invite_id}`** — sets status to "revoked". Teacher control.

4. **`POST /teacher/courses/{course_id}/sections/{section_id}/invites/{invite_id}/resend`** — refreshes token + expiry, re-sends email.

Remove: `POST .../students` (existing add-by-email) and keep only `DELETE .../students/{student_id}` for unenroll. Frontend will call the invite endpoint instead.

## Claim flow

Two paths — existing signup, and existing-user login.

**New user (signup path)** — extend `auth.py /register`:
- `RegisterRequest` already has `invite_token` for teacher invites. Add `section_invite_token` (separate field so they don't conflict; a user could theoretically have both, though rare).
- Validate section invite the same way: pending, not expired, email match.
- After user creation, create `SectionEnrollment`, set invite.status = "accepted".

**Existing user (already has account)** — new endpoint `POST /invites/sections/claim` body `{ token }`:
- Requires auth.
- Validates token (pending, not expired, email matches current user's email).
- Creates `SectionEnrollment`, sets invite.status = "accepted".
- This handles the case where a student already has an account, clicks the email link, is bounced to login, and then we claim on their behalf.

Email link format: `https://app.../invite/section?token=...`. Frontend landing page:
- Unauthenticated → redirect to signup with `section_invite_token` prefilled.
- Authenticated with matching email → call claim endpoint, redirect to section.
- Authenticated as different user → show "Sign out and sign in as {email}" message.

## Email template

Inline HTML (mirrors `admin_schools.py` teacher-invite email). Subject: `"You're invited to join {section_name} on Veradic AI"`. Body: teacher name ("Ms. Smith invited you..."), course + section, big "Accept invite" button linking to `/invite/section?token=...`, 14-day expiry notice.

Put the HTML in a small helper `api/core/email_templates.py` so we stop duplicating inline f-strings. Include teacher-invite template in the same file (refactor opportunity but keep scope tight — only move if it's clean).

## Frontend changes

`web/src/components/school/teacher/sections-tab.tsx`:
- Rename `addStudent` handler → `inviteStudent`, call new endpoint.
- Success UX: if response is `{ status: "enrolled" }`, show "Added {email}" and reload roster. If `{ status: "invited" }`, show "Invite sent to {email}" and reload pending invites.
- New **Pending invites** section in the card (between roster and invite form): list email + "Resend" + "Revoke" buttons.
- Update `web/src/lib/api.ts` with `inviteStudent`, `listInvites`, `revokeInvite`, `resendInvite`.

New route `web/src/app/invite/section/page.tsx` — claim landing page logic described above.

Update signup page to accept `section_invite_token` query param and pass through to register call.

## Commits (roughly)

1. `feat(api): add section_invites model + migration`
2. `feat(api): add section invite create/list/revoke/resend endpoints + email`
3. `feat(api): claim section invite on signup + existing-user claim endpoint`
4. `feat(web): invite students by email with pending state` (sections-tab + api.ts)
5. `feat(web): section invite landing page for claim flow`
6. `refactor(api): move invite emails into email_templates helper` (only if scope allows)

All on `fix/school-portal-cleanup`.

## Open questions before coding

1. **Courtesy email when user exists + instant-enrolled** — skip for v1 (YAGNI) or include? I'd skip.
2. **Duplicate pending invite behavior** — idempotent resend (my default) vs. 409 error? Idempotent is friendlier.
3. **Invite link host** — is there a `settings.web_app_url` or similar already for constructing the link? Need to confirm.
4. **Revoke vs. delete** — soft status flip ("revoked") keeps an audit trail. OK with that over hard delete?

## Out of scope (follow-ups)

- Bulk CSV invite upload
- Teacher view of accepted/expired invite history
- Auto-expire job (we lazily mark expired at validate time, matching teacher-invite flow)
