# Delete Account — Implementation Plan

## Overview

Users need a way to permanently delete their account (Apple App Store requirement + GDPR/CCPA compliance). Uses a **hybrid anonymization** approach: delete all PII, but preserve anonymous analytics data so admin dashboard metrics stay accurate.

## 1. Backend: `DELETE /v1/auth/account`

**Request:** `{ "password": "..." }` — verified via bcrypt

**Deletion order:**
1. **Hard delete** (PII / user-specific): `promo_redemptions`, `work_submissions`, `section_enrollments`, `refresh_tokens`
2. **Anonymize** (preserve analytics): `SET user_id = NULL` on `sessions` and `llm_calls`
3. **Hard delete** the `user` row

**Responses:**
- `204` — success
- `401` — wrong password
- `409` — teacher with active courses (must archive/transfer first)

**Schema:** `DeleteAccountRequest(password: str)` in `api/schemas/auth.py`
**Route:** Added to `api/routes/auth.py`

## 2. DB Migration

- `sessions.user_id` — make nullable (currently NOT NULL)
- `llm_calls.user_id` — make nullable (currently NOT NULL)
- Alembic migration to alter both columns

## 3. Admin Dashboard Adjustments

- `admin_users.py` — no changes needed (deleted user disappears from queries)
- `admin_overview.py` — anonymized rows still counted in aggregates
- `admin_sessions.py` — user filter excludes deleted users; anonymous sessions in totals
- `admin_llm.py` — shows "Deleted User" when `user_id IS NULL`

## 4. Mobile UI (`AccountScreen.tsx`)

**"Delete Account" button** — muted text, `trash-outline` icon, sits above "Log Out"

**Step 1 — Confirmation Alert** (native `Alert.alert`):
- "Delete Your Account?"
- "This will permanently delete your account and all your data. This cannot be undone."
- If active subscription: prepend warning about cancelling via App Store/Play Store
- Buttons: Cancel | Delete Account (destructive)

**Step 2 — Password Modal** (bottom sheet):
- "Verify Your Identity" / "Enter your password to confirm"
- Secure text input (same styling as LoginForm)
- "Delete My Account" red button + Cancel link
- Loading spinner during API call
- Wrong password: inline error + shake
- Success: clear tokens → auth screen

## 5. Web UI

- Same 2-step flow: confirmation dialog → password input → delete
- Same copy/warnings as mobile
- Success: clear localStorage → redirect to home

## 6. Commits

| # | Message | Scope |
|---|---------|-------|
| 1 | `feat: add delete account API endpoint with hybrid anonymization` | Schema, route, migration |
| 2 | `feat: add delete account UI to mobile AccountScreen` | Button, alert, password modal |
| 3 | `feat: add delete account UI to web app` | Dialog, password form, redirect |

## 7. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Wrong password | Inline error, retry allowed |
| Active subscription | Warning only — deletion proceeds, user must cancel sub separately |
| Teacher with courses | Blocked (409) — must archive/transfer first |
| Network error | Error toast, retry allowed |
| Admin analytics post-deletion | Aggregate numbers preserved, user disappears from user list |
| `user_id IS NULL` in admin views | Display "Deleted User" |
