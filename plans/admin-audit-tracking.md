# Plan: Admin Audit Tracking + Leads Cleanup

## Overview

Add "last edited by" audit tracking to the admin portal so admins can see who changed a record and when. Also clean up the Leads table (remove dead Students column, add optional Message field to the /teachers contact form).

## Changes

### 1. Migration: Add audit columns to 4 models

Add to `contact_leads`, `schools`, `promo_codes`, `users`:

- `updated_at` — DateTime(timezone=True), nullable (ContactLead and PromoCode don't have this yet; School and User already do but we keep theirs)
- `updated_by_id` — UUID FK → users(id), SET NULL on delete, nullable
- `updated_by_name` — String(200), nullable (denormalized for display resilience if admin is deleted)

All nullable — existing rows get NULL meaning "no edit history."

**Files:** New alembic migration, update model files.

### 2. Backend: Set audit fields on all admin mutations

Every admin endpoint that mutates a record sets:

```python
record.updated_by_id = current_user.user_id
record.updated_by_name = user_db.name or user_db.email
record.updated_at = func.now()
```

**Endpoints affected:**
- `PUT /admin/leads/{id}/status`
- `POST /admin/schools`, `PUT /admin/schools/{id}`
- `POST /admin/promo-codes`, `PUT /admin/promo-codes/{id}`
- `PUT /admin/users/{id}/role`
- `PUT /admin/users/{id}/subscription`
- `POST /admin/users/{id}/reset-daily-limit`

Include `updated_at` and `updated_by` (name string) in all list API responses.

### 3. Frontend: Add "Updated" column to Leads and Schools tables

Display format in the cell:
```
Ben Z.          ← admin name
2h ago          ← relative time, gray subtext
```

If never updated: "—" in muted gray.

**Leads table columns (7):** School, Contact, Role, Message, Status, Updated, Received
**Schools table columns (8):** School, Contact, Teachers, Students, Status, Updated, Added, (actions)

Promo Codes and Users: show last-modified info inline or as tooltip (tables already crowded).

### 4. Remove Students column from Leads table

The `approx_students` field is never populated — the /teachers form doesn't send it. Remove the column from the Leads table. If a lead mentions student count, it'll be in their message.

### 5. Add optional Message textarea to /teachers contact form

The DB and API already support a `message` field on contact leads. Add an optional "Anything else?" textarea to the `/teachers` page form. Low friction (optional), high value (context for prioritizing leads).

## Commit plan (~5 commits)

1. `feat: add message field to /teachers contact form`
2. `feat: add audit columns migration (updated_by_id, updated_by_name, updated_at)`
3. `feat: set audit fields in admin mutation endpoints`
4. `feat: display "Updated" column in Leads and Schools tables`
5. `fix: remove dead Students column from Leads table`

## Edge cases

- **Admin deleted** — FK becomes NULL but denormalized name persists
- **Never edited** — all audit columns NULL, frontend shows "—"
- **On create** — set audit fields too so you see who added the record
- **ContactLead created by public form** — audit fields stay NULL (no admin involved)
