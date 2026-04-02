# Plan: Admin Invite + Forgot Password

## Overview

Allow admins to invite other admins directly from the dashboard (no student registration required). Also wire up forgot password since it's the same flow.

## Backend

### New columns on User model (migration)

- `password_reset_token_hash` — String(255), nullable, unique
- `password_reset_expires` — DateTime(timezone=True), nullable

### New endpoint: `POST /admin/users/invite`

Request: `{ "email": "jane@veradicai.com", "name": "Jane Smith" }`

1. Check if user with email already exists → 409 "User already exists"
2. Create User with `role="admin"`, `is_active=True`, random password hash, `grade_level=0`
3. Generate URL-safe token, store hashed, expires in 48h
4. Send email: "You've been invited as an admin. Click here to set your password."
5. Return `{ "status": "ok" }`

### New endpoint: `POST /auth/forgot-password`

Request: `{ "email": "user@example.com" }`

1. Find user by email — if not found, return 200 anyway (don't leak existence)
2. Generate token, store hashed, expires in 1h
3. Send email: "Click here to reset your password."
4. Return `{ "status": "ok" }`

### New endpoint: `POST /auth/set-password`

Request: `{ "token": "abc123...", "password": "newpassword" }`

1. Hash the token, find matching user
2. Check not expired → 400 "Link expired"
3. Check token exists → 400 "Link already used"
4. Set new password hash, clear token fields
5. Return `{ "status": "ok" }`

## Frontend (Dashboard)

### Users page — "Invite Admin" button

- Button next to page title (same style as Schools "+ Add School")
- Opens inline form: Name (required), Email (required)
- On success: green banner "Invite sent to email", reload users list
- Error: show "User already exists" inline

### Login page — "Forgot password?" link

- Link below the login form
- Opens inline email input + "Send Reset Link" button
- On success: "Check your email" message

## Frontend (Web App)

### New page: `/set-password?token=xxx`

- "Set Your Password" heading
- Password input + confirm password input
- Submit button
- On success: redirect to login
- On expired/invalid token: show error with "Ask an admin to resend"

### Login page — "Forgot password?" link

- Same as dashboard login

## Emails

**Admin invite:**
- Subject: "You've been invited to Veradic AI Admin"
- Body: greeting, invite context, [Set Password] button link, 48h expiry note

**Password reset:**
- Subject: "Reset your Veradic AI password"
- Body: greeting, [Reset Password] button link, 1h expiry note, "If you didn't request this, ignore"

## Edge cases

- Email already exists → 409, suggest changing role from Users table
- Token expired → clear error, ask admin to resend
- Token already used → cleared after use, show "already used"
- Self-invite → allowed
- Non-admin email domain → no restriction
- Forgot password for non-existent email → 200 (no info leak)
- Multiple reset requests → latest token overwrites previous

## Commit plan (~5 commits)

1. `feat: add password reset token columns to User model + migration`
2. `feat: add admin invite, forgot-password, and set-password endpoints`
3. `feat: add Invite Admin UI to dashboard Users page`
4. `feat: add /set-password page and forgot-password to web app`
5. `feat: add forgot-password to admin dashboard login page`
