# Plan: Delete School Button + Email Integration

## Feature 1: Delete School from Admin Dashboard

**Why:** Schools can only be deactivated right now. Need to fully remove test/junk/old schools from the DB.

**Cascade behavior (already defined in models):**
- `TeacherInvite` → CASCADE deleted (all pending invites removed)
- `User.school_id` (teachers) → SET NULL (teachers keep accounts, lose school affiliation)
- Students/courses/sections → unaffected (no direct FK to school)

### Backend

- New endpoint: `DELETE /v1/admin/schools/{school_id}` in `admin_schools.py`
- Verify school exists, delete it, AUDIT log
- Return confirmation with counts (invites deleted, teachers unlinked)

### Dashboard UI (Schools.tsx)

- Red "Delete" button in actions column next to Deactivate
- Confirmation modal:
  - Shows school name, teacher count, pending invite count
  - Warning: "This will permanently delete the school, cancel all pending invites, and unlink N teachers. This cannot be undone."
  - Red "Delete School" confirm button + "Cancel"
- Success → toast, refresh list
- Error → error toast

---

## Feature 2: Email Integration (Resend)

### Core email service

- `api/core/email.py` — Resend SDK, async fire-and-forget
- Graceful fallback: if RESEND_API_KEY not set, log warning and skip
- Config in `api/config.py`:
  - `RESEND_API_KEY`
  - `EMAIL_FROM_ADDRESS` = `"Veradic AI <support@veradicai.com>"`
  - `ADMIN_ALERT_EMAILS` = `["ben@veradicai.com", "nathaniel@veradicai.com", "support@veradicai.com"]`
- Add `resend` dependency to `pyproject.toml`

### Email 1: New lead notification

- **Trigger:** Contact form submitted (`POST /v1/contact/lead`)
- **To:** ben@veradicai.com, nathaniel@veradicai.com, support@veradicai.com
- **From:** support@veradicai.com
- **Subject:** "New school lead: {school_name}"
- **Body:** Contact name, email, role, student count, message, link to admin dashboard
- **Fallback:** If email fails, lead is still saved — no crash

### Email 2: Teacher invite (on lead conversion)

- **Trigger:** Admin invites teacher to a school (`POST /v1/admin/schools/{school_id}/invite`)
- **To:** The teacher's email
- **From:** support@veradicai.com
- **Subject:** "You've been invited to join {school_name} on Veradic AI"
- **Body:** School name, invite link (`https://veradicai.com/register?invite={token}`), 14-day expiry note
- **Fallback:** If email fails, invite still created — admin can copy URL manually

---

## Commit Plan

1. `feat: add delete school endpoint and admin UI`
2. `feat: add Resend email service core`
3. `feat: send admin notification on new contact lead`
4. `feat: send teacher invite email on school invite`
