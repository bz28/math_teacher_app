# API Reference

Quick reference for all backend endpoints. Base URL: `https://mathteacherapp-production.up.railway.app/v1`

All endpoints except `/auth/login`, `/auth/register`, `/auth/check-email`, and `/health` require a Bearer token in the `Authorization` header.

---

## Auth

### `POST /auth/register`
Create a new account.

**Body:**
```json
{
  "email": "student@school.edu",
  "password": "MyPass123",
  "grade_level": 8
}
```
**Password rules:** 8+ characters, at least one uppercase, at least one digit.

**Response:** `201` with `{ access_token, refresh_token, user }`

---

### `POST /auth/login`
Log in. Returns tokens.

**Body:**
```json
{
  "email": "student@school.edu",
  "password": "MyPass123"
}
```
**Response:** `200` with `{ access_token, refresh_token, user }`

**Errors:**
- `401` — Invalid credentials (wrong email or password, same message for both).
- `423` — Account locked (5+ failed attempts, wait 15 minutes).

---

### `POST /auth/refresh`
Exchange a refresh token for new access + refresh tokens. The old refresh token is revoked.

**Body:**
```json
{
  "refresh_token": "old-refresh-token"
}
```
**Response:** `200` with `{ access_token, refresh_token }`

**Errors:**
- `401` — Token expired, revoked, or reused (entire family invalidated on reuse).

---

### `POST /auth/check-email`
Check if an email is available for registration.

**Body:**
```json
{
  "email": "student@school.edu"
}
```
**Response:** `200` with `{ available: true/false }`

---

### `GET /auth/me`
Get the current user's profile. Requires auth.

**Response:** `200` with `{ id, email, grade_level, role, created_at }`

---

## Sessions

### `POST /session`
Create a new tutoring session.

**Body:**
```json
{
  "problem": "2x + 6 = 12",
  "mode": "learn"
}
```
- `mode`: `"learn"` (step-by-step guided) or `"practice"` (answer-focused).
- `problem`: max 5,000 characters.

**Response:** `201` with full session state (steps, current_step, status, exchanges).

**Errors:**
- `429` — Daily session cap reached.
- `503` — LLM service unavailable (circuit breaker open or cost limit reached).

---

### `GET /session/{session_id}`
Get the current state of a session. Only the session owner can access it.

**Response:** `200` with session state.

**Note:** In learn mode, the final step's answer is hidden while the session is active (prevents cheating via network inspection).

**Errors:**
- `404` — Session not found.
- `403` — Not your session.

---

### `POST /session/{session_id}/respond`
Submit a response to the current step.

**Body:**
```json
{
  "student_response": "x = 3",
  "request_advance": false
}
```
- `student_response`: max 2,000 characters. The student's answer or question.
- `request_advance`: `true` to advance to next step in learn mode (the "I understand" button).

**Response:** `200` with step response (feedback, whether correct, updated session state).

**Errors:**
- `400` — Session already completed, or invalid input.
- `403` — Not your session.

---

## Practice

### `POST /practice/generate`
Generate similar practice problems.

**Body:**
```json
{
  "problem": "2x + 6 = 12",
  "count": 5
}
```
- `count`: 0–20 problems to generate.

**Response:** `200` with `{ problems: [{ question, answer }] }`

---

### `POST /practice/check`
Check if a practice answer is correct.

**Body:**
```json
{
  "question": "3x + 2 = 11",
  "correct_answer": "3",
  "user_answer": "3.0"
}
```

**Response:** `200` with `{ is_correct: true/false, feedback: "..." }`

---

## Image

### `POST /image/extract`
Extract math problems from a photo using Claude Vision.

**Body:**
```json
{
  "image_base64": "<base64-encoded JPEG or PNG>",
  "extract_multiple": true
}
```
- Max image size: 5 MB after decode (base64 string max ~7 MB).
- Only JPEG and PNG accepted (validated by magic bytes, not extension).

**Response:** `200` with `{ problems: ["2x + 6 = 12", "x² - 4 = 0"], confidence: "high" }`

---

## Admin

All admin endpoints require the `admin` role.

### `GET /admin/overview`
Dashboard overview: sessions today/yesterday, daily cost, active users, completion rates, chart data.

### `GET /admin/llm-calls`
LLM call analytics: cost by function/model/day, detailed call logs with pagination.

**Query params:** `page`, `per_page`, `function`, `model`, `days`

### `GET /admin/sessions`
Session analytics: completion rates by day/mode, top problems, abandoned sessions.

**Query params:** `days`

### `GET /admin/users`
User analytics: registration trends, session distribution by activity level.

**Query params:** `days`

---

## Health

### `GET /health`
Returns `200` if the server is running. No auth required.

---

## Common Error Codes

| Code | Meaning |
|------|---------|
| `400` | Bad request — invalid input, session completed, validation error |
| `401` | Unauthorized — missing, invalid, or expired token |
| `403` | Forbidden — deactivated account, wrong role, not your resource |
| `404` | Not found — resource doesn't exist |
| `413` | Payload too large — request body exceeds 10 MB |
| `423` | Locked — account locked after too many failed login attempts |
| `429` | Too many requests — daily session cap reached |
| `503` | Service unavailable — LLM down, circuit breaker open, or cost limit reached |
