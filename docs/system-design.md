# System Design

How the math teacher app is built, what each piece does, and why we chose it. Written so any engineer can onboard quickly and any technical stakeholder can understand the tradeoffs.

---

## Architecture Overview

```
React Native (iOS/Android)          React Web (Admin Dashboard)
        |                                    |
        +------- HTTPS  /v1/* API -----------+
                        |
              FastAPI (Python, async)
               /                    \
          Claude API            PostgreSQL 16
        (Sonnet + Haiku)         (async via SQLAlchemy)
```

**Three main surfaces:**
1. **Mobile app** — React Native (Expo). Student-facing. iOS and Android from one codebase.
2. **Admin dashboard** — React web app (Vite + React Router). For monitoring usage, costs, and analytics.
3. **Backend API** — FastAPI (Python 3.12+). Handles auth, sessions, LLM calls, cost tracking.

---

## Why This Stack

| Choice | Why | Alternatives Considered |
|--------|-----|------------------------|
| **React Native (Expo)** | One codebase for iOS + Android. Expo simplifies builds and native module access. | Flutter (smaller hiring pool), native (2x development cost) |
| **FastAPI** | Async-first Python. Great for streaming LLM responses and concurrent DB queries. | Django (heavier, sync-first), Node (team's Python strength) |
| **PostgreSQL** | Battle-tested relational DB. Async support via asyncpg. JSON columns for flexible session data. | MongoDB (schema flexibility not worth losing joins), SQLite (no concurrent access) |
| **Claude API** | Powers both math solving and tutoring. One provider for all LLM needs. | GPT-4 (comparable, but Claude's structured output and math reasoning fit better) |
| **Zustand** | Lightweight state management for React Native. Simpler than Redux for our scope. | Redux (overkill), React Context (doesn't scale for session state complexity) |
| **Railway** | Simple deployment with managed Postgres. Good for early stage. | AWS (too much infra overhead), Heroku (pricing) |

---

## API Design

### Versioning
All routes prefixed with `/v1/`. The app is sold to schools — once they integrate, the API can't break. Versioning from day one is cheap insurance.

### Route Organization

| Domain | Prefix | Purpose |
|--------|--------|---------|
| Auth | `/v1/auth/*` | Register, login, refresh, check-email, me |
| Session | `/v1/session/*` | Create session, get state, submit response |
| Practice | `/v1/practice/*` | Generate similar problems, check answers |
| Image | `/v1/image/*` | Extract math problems from photos |
| Admin | `/v1/admin/*` | Usage analytics, cost monitoring, user management |
| Health | `/v1/health` | Liveness check |

### Authentication Flow
```
Client                          Server
  |-- POST /auth/login ----------->|
  |<-- {access_token, refresh} ----|
  |                                |
  |-- GET /session (Bearer token)->|  (access token in Authorization header)
  |<-- session data ---------------|
  |                                |
  |-- (token expired, 401) ------->|
  |-- POST /auth/refresh --------->|  (sends refresh token)
  |<-- {new_access, new_refresh} --|  (old refresh token revoked)
```

---

## Database Schema

### Core Models

**User** — who's using the app.
- `id` (UUID), `email` (unique, indexed), `password_hash` (bcrypt)
- `grade_level` (1–12), `role` (student/school/admin), `is_active`
- `failed_login_attempts`, `locked_until` (brute force protection)

**RefreshToken** — tracks token chains for rotation and theft detection.
- `token_hash` (SHA256, unique), `family_id` (groups tokens from same login)
- `is_revoked`, `expires_at`
- FK to User with CASCADE delete

**Session** — one tutoring session for one problem.
- `problem` (text), `problem_type`, `mode` (learn/practice)
- `steps` (JSON array), `current_step`, `total_steps`, `status` (active/completed/abandoned)
- `exchanges` (JSON array of conversation history, trimmed to last 10)
- FK to User, indexed on `(user_id, created_at)`

**LLMCall** — audit log for every Claude API call.
- `function` (decompose/solve/converse/step_chat/etc.), `model`, `input_tokens`, `output_tokens`
- `cost_usd`, `latency_ms`, `success`, `retry_count`
- `input_text`, `output_text` (truncated to 10 KB)
- FK to Session and User

### Relationships
```
User  1──N  RefreshToken  (cascade delete)
User  1──N  Session       (cascade delete)
User  1──N  LLMCall       (set null on delete)
Session 1──N  LLMCall     (set null on delete)
```

### Migrations
Alembic manages all schema changes. Every PR that touches models includes a migration. The Docker entrypoint runs `alembic upgrade head` before starting the server.

---

## LLM Integration

### Model Selection Strategy

We use two Claude models with different price/capability tradeoffs:

| Model | Cost (input/output per 1M tokens) | Used For |
|-------|-----------------------------------|----------|
| **Sonnet** | $3.00 / $15.00 | Reasoning: step decomposition, answer evaluation, similar problem generation |
| **Haiku** | $0.80 / $4.00 | Classification: step chat, post-completion chat, answer equivalence checks, practice evaluation |

**Rule of thumb:** If it needs to reason about math, use Sonnet. If it's classifying or formatting, use Haiku.

### Call Lifecycle
```
1. Check daily cost limit (fail fast if exceeded)
2. Check circuit breaker (fail fast if open)
3. Build prompt (system + user messages)
4. Call Claude API (30s timeout)
5. Parse JSON response
6. Calculate cost from token usage
7. Add cost to daily tracker
8. Log call to database (fire-and-forget)
9. Return parsed response
```

### Reliability
- **Retry:** 3 attempts with exponential backoff (2^n seconds).
- **Circuit breaker:** Opens after 5 consecutive failures, cooldown 30 seconds.
- **Timeout:** 30 seconds per call.
- **Cost tracking:** Every call logged with tokens, cost, latency, success/failure.

### Prompt Caching
- System prompts use Claude's `cache_control: {type: "ephemeral"}` to avoid re-processing on repeated calls.
- Few-shot examples cached in-memory (LRU, max 20 problem types) and included in prompts for consistency.

---

## Session Lifecycle

### Two Modes

**Learn Mode** — guided step-by-step tutoring:
```
Create session
  → Claude decomposes problem into steps
  → Each step: student reads, asks questions, clicks "I understand"
  → Final step: multiple choice (correct answer + 3 distractors)
  → Correct answer → session complete
  → Wrong answer → "Not quite, try again"
Post-completion: student can keep asking questions (Haiku, max 10 messages)
```

**Practice Mode** — answer-focused:
```
Create session
  → Claude solves for the final answer (no step breakdown)
  → Student submits answer
  → Exact match or LLM equivalence check
  → Correct → complete. Wrong → "Incorrect, try again" (unlimited retries)
```

### State Machine
```
ACTIVE → COMPLETED  (all steps done correctly)
ACTIVE → ABANDONED  (no activity for 1+ hour, cleaned up on server startup)
```

### Conversation History
- Stored as JSON array of `{role, content, timestamp}` in the session.
- Trimmed to last 10 exchanges to bound storage and LLM prompt size.
- Last 6 exchanges sent to Claude for conversational context.

---

## Middleware Stack

Ordered outermost → innermost (a request hits them in this order):

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | **RequestSizeLimit** | Reject bodies > 10 MB before reading them |
| 2 | **SecurityHeaders** | Add HSTS, CSP, X-Frame-Options, etc. to every response |
| 3 | **CORS** | Validate origin, handle preflight requests |
| 4 | **Logging** | Generate request ID, log method/path/status/duration as JSON |

Authentication is handled per-route via FastAPI dependencies (`get_current_user`, `require_admin`), not as global middleware — so health checks and login don't require tokens.

---

## Frontend Architecture

### Mobile (React Native + Expo)

**Navigation** (screen-based, no router library):
```
Onboarding → Auth → Home → Mode Select → Input → Session
```

**State Management** (Zustand):
- Single store (`session.ts`) manages: current session, phase, last response, practice batch, learn queue, problem queue.
- Phases: `idle → loading → awaiting_input → thinking → completed`

**API Layer** (`api.ts`):
- Singleton with secure token storage.
- Automatic 401 → refresh → retry (transparent to callers).
- Deduplicates concurrent refresh attempts (prevents race conditions).
- Timeouts: 15s default, 30s for LLM calls.

### Admin Dashboard (React + Vite)

**Pages:**
- **Overview** — sessions today/yesterday, daily cost, active users, completion rate.
- **Sessions** — completion rates by day/mode, top problems, abandoned sessions.
- **LLM Calls** — cost by function/model/day, detailed call logs with pagination.
- **Users** — registration trends, session distribution.

**Charts:** Recharts (bar, line, area).

---

## Cost Architecture

### Why It Matters
Claude API calls cost real money. At school scale (hundreds of students), uncontrolled usage can get expensive fast.

### Three Layers of Protection

1. **Per-user daily session cap** — limits how many sessions one user can create (50 free, 500 school).
2. **Global daily cost limit** — server-wide $50/day cap. Checked before every LLM call.
3. **Smart model selection** — Haiku ($0.80/1M) for simple tasks, Sonnet ($3/1M) for reasoning. Saves ~75% on classification calls.

### Observability
- Every LLM call's cost is logged to the database.
- Admin dashboard shows daily cost trends, cost by function, cost by model.
- Sentry alerts on unusual error rates.

---

## Deployment

### Production (Railway)
- **Backend:** Docker container → Railway. Auto-deploys on push to main.
- **Database:** Managed PostgreSQL 16 on Railway.
- **SSL:** Handled by Railway (HTTPS termination).
- **Env vars:** Injected via Railway console (JWT secret, Claude key, Sentry DSN, DB URL).

### Docker
```dockerfile
FROM python:3.12-slim
# Install deps with uv (fast pip alternative)
# Copy code
# CMD: alembic upgrade head && uvicorn api.main:app
```

Migrations run on every deploy before the server starts. If a migration fails, the deploy fails — no half-migrated state.

### Local Development
```bash
docker compose up          # PostgreSQL 16 + FastAPI with live reload
# or
uvicorn api.main:app       # if you have a local Postgres
```

### CI/CD (GitHub Actions)
- **Backend:** Python 3.12, PostgreSQL 16, ruff lint, mypy type check, pytest (unit tests, no integration).
- **Mobile:** Node 20, TypeScript type check.
- Integration tests (real Claude API calls) excluded from CI — run manually.

---

## Performance Optimizations

| Optimization | What It Does |
|-------------|-------------|
| **Connection pooling** | 10 persistent + 20 overflow DB connections, recycled every 5 min |
| **Prompt caching** | Claude caches system prompts for 5 min (saves input tokens) |
| **Few-shot caching** | In-memory LRU cache of decompositions by problem type (up to 20 types) |
| **Conversation trimming** | Only last 10 exchanges stored, last 6 sent to LLM |
| **Fire-and-forget logging** | LLM call persistence doesn't block the response |
| **Async everywhere** | All DB queries and LLM calls are non-blocking |
| **Response truncation** | LLM responses capped at 10 KB in database |

---

## Key Design Decisions

### No secrets on mobile
All API keys live on the backend. The mobile app only holds its JWT. This means keys can't be extracted from the APK/IPA, all requests are authenticated and rate-limited, and third-party services never see student identity.

### JSON columns for session state
Steps and conversation exchanges are stored as JSON arrays in PostgreSQL, not in separate tables. This keeps the schema simple and avoids N+1 queries. The tradeoff is that you can't easily query individual steps — but we never need to. Sessions are always loaded whole.

### Two LLM models, not one
Using Haiku for simple tasks saves ~75% on those calls compared to Sonnet. The classification boundary is clear: "does it need to reason about math?" If yes, Sonnet. If no, Haiku.

### API versioning from day one
Schools integrate once and expect stability. `/v1/` prefix costs nothing and gives us room to evolve without breaking existing clients.

### Refresh token families
Instead of a simple token blacklist, we use family-based tracking. This lets us detect stolen tokens (reuse of a rotated token) and invalidate the entire chain. More complex to implement, but critical for a school app where sessions might be shared on classroom devices.
