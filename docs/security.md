# Security

How we protect student data, prevent abuse, and keep the system safe. Written so any engineer, auditor, or school admin can understand what's in place and why.

---

## Authentication

### Passwords
- Hashed with **bcrypt** (per-password salt, constant-time comparison). Plaintext is never stored or logged.
- Minimum 8 characters, at least one uppercase letter, one digit. Enforced on both client and server.

### JWT Access Tokens
- Algorithm: HS256, signed with a server-side secret.
- Short-lived: **15 minutes**. If stolen, the window of damage is small.
- Payload contains `user_id` and `role` — no sensitive data.

### Refresh Token Rotation
- Refresh tokens last **7 days** and are **single-use**.
- Stored as a SHA256 hash (not plaintext) in the database.
- Each token belongs to a "family" (a chain of rotations from the same login).
- **Theft detection:** If someone reuses an already-rotated token, the entire family is invalidated. This means if an attacker steals a token, the legitimate user's next refresh kills the attacker's access too.

### Brute Force Protection
- **5 failed login attempts** → account locked for **15 minutes**.
- Counter resets on successful login.
- Login responses use the same generic message ("Invalid credentials") for wrong email and wrong password — prevents confirming whether an email exists.

### User Deactivation
- Every authenticated request checks `is_active` on the user record.
- Setting `is_active=False` immediately blocks all access — no need to wait for token expiry.

### Mobile Token Storage
- Tokens stored in **expo-secure-store** (platform-native encrypted storage: Keychain on iOS, Keystore on Android).
- Not AsyncStorage, not localStorage.

---

## Authorization

### Role-Based Access Control
- Three roles: `student`, `school`, `admin`.
- Admin endpoints (`/v1/admin/*`) require the `admin` role — enforced by a shared dependency (`require_admin`).
- Daily session caps vary by role (free: 50/day, school: 500/day).

### Session Ownership
- Every session GET/respond checks that the requesting user owns the session.
- Returns 403 Forbidden if they don't — no information about whether the session exists.

---

## Rate Limiting & Cost Control

### Per-User Daily Session Cap
- Free users: **50 sessions/day**. School users: **500 sessions/day**.
- Checked at session creation. Returns HTTP 429 when exceeded.

### Global Daily Cost Limit
- A server-wide **$50/day** cap on Claude API spend (configurable).
- Checked before every LLM call. If exceeded, the call is rejected immediately — no money is spent.
- Tracked in-memory with an async lock, reset at midnight UTC.
- There's a small TOCTOU window between check and spend, but the overshoot is bounded to one call (~$0.01).

### Circuit Breaker
- After **5 consecutive Claude API failures**, the circuit breaker opens for **30 seconds**.
- During cooldown, all LLM calls fail immediately instead of piling up retries against a broken service.

### Request Size Limit
- **10 MB** max request body, enforced by middleware.
- Fast-reject on `Content-Length` header; also tracks bytes for chunked transfers.
- Images validated separately: **5 MB** max after base64 decode, magic-byte format check (JPEG/PNG only).

### Input Field Limits
- Problem text: max 5,000 characters.
- Student response: max 2,000 characters.
- Base64 image payload: max 7 MB (decodes to ~5 MB).

---

## Input Validation

### Server-Side (Pydantic Schemas)
- All request bodies validated against strict Pydantic models.
- Email: RFC-compliant via `EmailStr`.
- Grade level: integer 1–12.
- Session mode: regex-enforced `^(learn|practice)$`.
- String lengths: enforced min/max on all text fields.

### Image Validation
- Format detected by **magic bytes** (file header), not file extension. Rejects anything that isn't JPEG or PNG.
- Size enforced after base64 decode, not on the encoded string.

### SQL Injection Prevention
- All database queries use **SQLAlchemy ORM** with parameterized statements. No string interpolation anywhere.

---

## HTTP Security Headers

Every response includes:

| Header | Value | Why |
|--------|-------|-----|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Forces HTTPS for 1 year |
| `Content-Security-Policy` | `default-src 'self'` | Blocks loading resources from other origins |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframes |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer data leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables dangerous browser APIs |
| `X-XSS-Protection` | `0` | Disables legacy XSS auditor (can cause more harm than good) |

---

## CORS

- **Whitelist-based**: only explicitly configured origins are allowed (default: `localhost:8081`, `localhost:3000`).
- Credentials allowed (for Authorization header).
- Methods restricted to GET, POST, PUT, DELETE, OPTIONS.
- Headers restricted to Authorization and Content-Type.

---

## Secrets Management

- All secrets (JWT secret, Claude API key, Sentry DSN, database URL) loaded from **environment variables** via Pydantic `BaseSettings`.
- `.env` files are gitignored (`.env`, `.env.local`, `.env.production`).
- App **refuses to start** if required secrets are missing — validated on boot.
- No secrets on the mobile app. All API keys live on the backend. The mobile app only knows its own JWT.

---

## Error Handling & Info Leakage Prevention

- Login returns the same error for wrong email and wrong password → prevents **user enumeration**.
- Session not found and permission denied both return generic messages → prevents **resource enumeration**.
- Internal errors return safe HTTP status codes (400, 401, 403, 404, 429, 503) with generic messages. Stack traces never reach the client.
- LLM response text is **truncated to 10 KB** before database storage to prevent unbounded growth.

---

## Data Protection

### No Secrets on Mobile
- The mobile app never talks directly to Claude or any external service.
- All API keys live on the backend. Third-party services never see student identity.

### Answer Hiding (Learn Mode)
- The final-step answer is **stripped from the API response** while the session is active.
- Prevents cheating via network inspection (dev tools, proxy).

### Session Isolation
- Students can only access their own sessions.
- Stale sessions (1+ hour inactive) are automatically marked as abandoned on server startup.
- Expired and revoked refresh tokens are cleaned up on startup to prevent table bloat.

---

## Monitoring & Observability

### Sentry
- Initialized in production if `SENTRY_DSN` is set.
- Captures exceptions and performance data.
- Sample rate: 100% in dev, 20% in production.

### Structured Logging
- All logs are JSON-formatted with: `timestamp`, `level`, `request_id`, `user_id`, `session_id`, `method`, `path`, `status_code`, `duration_ms`.
- `request_id` is generated per-request (or taken from `X-Request-ID` header) for end-to-end tracing.

### LLM Call Auditing
- Every Claude API call is logged to the database: function, model, tokens, cost, latency, success/failure, retry count.
- Tagged with `user_id` and `session_id` for debugging ("why did the tutor say X?").

---

## Database Security

- **Connection pooling**: 10 persistent + 20 overflow connections, recycled every 5 minutes, pre-ping enabled.
- **Unique constraints**: email has a unique index; refresh token hashes are unique.
- **Foreign keys with CASCADE**: deleting a user cascades to their tokens and sessions.
- **Migrations**: Alembic manages all schema changes — no manual DDL.

---

## Known Gaps & Future Work

| Gap | Risk | Plan |
|-----|------|------|
| Admin dashboard stores JWT in `localStorage` | XSS could steal admin token | Migrate to `sessionStorage` or HttpOnly cookie |
| Dockerfile runs as root | Container escape has higher blast radius | Add `USER 1000:1000` directive |
| No per-IP rate limit on `/auth/login` | Distributed brute force across accounts | Add IP-based rate limiting middleware |
| Cost tracker TOCTOU window | Could overshoot daily limit by one call | Accepted risk (~$0.01 max overshoot) |
