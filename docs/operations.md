# Operations Runbook

How to deploy, monitor, and troubleshoot the math teacher app. Written so anyone on the team can handle incidents and routine operations.

---

## Environments

| Environment | Backend | Database | How to access |
|-------------|---------|----------|---------------|
| **Local** | `uvicorn` or `docker compose up` | Local PostgreSQL 16 (via docker-compose) | `http://localhost:8000/v1/` |
| **Production** | Railway (Docker) | Railway managed PostgreSQL | `https://math-teacher-api.up.railway.app/v1/` |

---

## Deployment

### How Production Deploys Work
1. Code merges to `main`.
2. Railway auto-detects the push and builds a Docker image.
3. The Docker entrypoint runs: `alembic upgrade head && uvicorn api.main:app --host 0.0.0.0 --port 8000`
4. If the migration fails, the deploy fails — no half-migrated state.
5. Railway rolls back to the previous healthy deploy automatically.

### Environment Variables (Railway Console)

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://user:pass@host:5432/db` |
| `JWT_SECRET` | Yes | (random 64-char string) |
| `CLAUDE_API_KEY` | Yes | `sk-ant-...` |
| `SENTRY_DSN` | No | `https://abc@o123.ingest.us.sentry.io/456` |
| `APP_ENV` | No | `production` (default: `development`) |
| `LOG_LEVEL` | No | `INFO` (default) |
| `CORS_ORIGINS` | No | `["https://dashboard.example.com"]` |
| `DAILY_COST_LIMIT_USD` | No | `50.0` (default) |
| `REVENUECAT_WEBHOOK_SECRET` | No | Shared secret from RevenueCat dashboard |
| `BYPASS_SUBSCRIPTION` | No | `true` to skip entitlement checks (dev only) |

### Deploying Database Migrations
Migrations run automatically on every deploy (`alembic upgrade head` in the Docker CMD). To create a new migration locally:

```bash
cd api
alembic revision --autogenerate -m "description of change"
# Review the generated migration in api/alembic/versions/
# Test locally, then commit and push
```

---

## Monitoring

### Sentry (Error Tracking)
- **Dashboard:** Check your Sentry project for `math-teacher-api`.
- Captures all unhandled exceptions and performance data.
- Sample rate: 20% in production, 100% in dev.
- Set up alerts for new issues and error spikes (see `docs/sentry-setup.md`).

### Structured Logs
All logs are JSON with these fields:
```json
{
  "timestamp": "2026-03-12T14:30:00Z",
  "level": "INFO",
  "logger": "api.access",
  "message": "POST /v1/session 201",
  "request_id": "abc-123",
  "user_id": "user-456",
  "session_id": "sess-789",
  "method": "POST",
  "path": "/v1/session",
  "status_code": 201,
  "duration_ms": 1234.5
}
```

**How to trace a request:** Search logs by `request_id`. Every log line for that request shares the same ID.

**How to debug "why did the tutor say X?":** Find the session's LLM calls in the `llm_calls` table by `session_id`. Each call stores `input_text` and `output_text` (truncated to 10 KB).

### Admin Dashboard
- **URL:** Your deployed dashboard URL.
- Shows: sessions per day, daily cost, active users, completion rates, LLM call analytics.
- Useful for spotting cost spikes, usage trends, and unusual patterns.

---

## Troubleshooting

### "503 Service Unavailable" on session creation
**Likely cause:** Claude API is down or the daily cost limit was hit.

**Check:**
1. Is the circuit breaker open? Look for "Circuit breaker open" in logs.
2. Has the daily cost limit been reached? Check admin dashboard or logs for "Daily cost limit exceeded".
3. Is Claude API actually down? Check [Anthropic's status page](https://status.anthropic.com).

**Fix:**
- If circuit breaker: wait 30 seconds, it auto-resets.
- If cost limit: increase `DAILY_COST_LIMIT_USD` in Railway env vars, or wait until midnight UTC.
- If Claude outage: wait for Anthropic to resolve.

### "403 Entitlement Required"
**Cause:** Free user tried to use a Pro-only feature or hit their daily session limit.

**Check:** The response body contains `entitlement` (which feature was blocked) and `is_limit` (whether it was a daily limit vs feature gate).

**Fix:** User needs to subscribe to Pro. No server-side override — use `BYPASS_SUBSCRIPTION=true` in dev only.

### "423 Locked" on login
**Cause:** 5+ failed login attempts.

**Fix:** Wait 15 minutes. The lockout is automatic. There's no manual unlock endpoint yet.

### Tokens not refreshing (401 loop on mobile)
**Cause:** Refresh token was reused (possibly from a second device), which invalidated the entire token family.

**Fix:** User needs to log in again. This is working as intended — it's theft detection.

### Slow session creation
**Cause:** Step decomposition (Sonnet) takes 2–5 seconds. Practice mode is faster (~1 second) since it only solves for the answer.

**Not a bug.** LLM calls have inherent latency. The mobile app shows a loading state.

### Database connection errors
**Check:**
1. Is PostgreSQL running? Check Railway dashboard.
2. Is the connection pool exhausted? Look for pool timeout errors in logs.

**Fix:**
- Connection pool: 10 persistent + 20 overflow. If exhausted, you may need to increase `pool_size` in `database.py` or find a long-running query.
- Connections recycle every 5 minutes and are pre-pinged before use.

### Migration fails on deploy
**Cause:** The Alembic migration in the latest commit has an error.

**Fix:**
1. Railway auto-rolls back to the previous deploy.
2. Fix the migration locally, test with `alembic upgrade head` against a local DB.
3. Push the fix.

---

## Routine Operations

### Checking CI Status
```bash
gh pr checks <PR-number>
```
CI runs automatically on PRs. Backend: lint (ruff), type check (mypy), unit tests (pytest). Mobile: TypeScript type check.

### Viewing Production Logs
```bash
# Via Railway CLI (if installed)
railway logs

# Or via Railway web dashboard → your service → Logs tab
```

### Querying LLM Cost
```sql
-- Total cost today
SELECT SUM(cost_usd) FROM llm_calls WHERE created_at >= CURRENT_DATE;

-- Cost by model today
SELECT model, SUM(cost_usd), COUNT(*) FROM llm_calls
WHERE created_at >= CURRENT_DATE GROUP BY model;

-- Cost by function today
SELECT function, SUM(cost_usd), COUNT(*) FROM llm_calls
WHERE created_at >= CURRENT_DATE GROUP BY function;
```

Or just check the admin dashboard — it shows all of this.

### Creating an Admin User
There's no admin registration endpoint. Promote a user directly in the database:
```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@school.edu';
```

### Cleaning Up Old Data
On every server startup, the app automatically:
- Marks sessions inactive for 1+ hour as `ABANDONED`.
- Deletes expired and revoked refresh tokens.

No manual cleanup needed.

---

## Incident Response Checklist

1. **Identify:** What's broken? Check Sentry alerts, user reports, admin dashboard.
2. **Triage:** Is it affecting all users or just one? Check logs by `request_id` or `user_id`.
3. **Contain:** If it's a cost issue, lower `DAILY_COST_LIMIT_USD`. If it's a Claude issue, the circuit breaker should already be handling it.
4. **Fix:** Deploy a fix via normal PR → merge → auto-deploy flow. Railway deploys in ~2 minutes.
5. **Verify:** Check Sentry for new errors, check admin dashboard for normal metrics.
6. **Postmortem:** What broke, why, and what do we change to prevent it?
