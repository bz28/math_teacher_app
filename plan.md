# Math Teacher App - Build Plan

## Vision
An AI-powered math tutoring app where students input problems (photo or text), work through solutions step-by-step with guided feedback, and confirm understanding before advancing. Sold to schools, used independently by students.

## Architecture

```
React Native (iOS/Android)
        ↓
FastAPI (Python) ← SymPy (in-process math engine)
        ↓               ↓
  Claude API        PostgreSQL
  (tutor layer)    (users, progress)
```

**Why this stack:** Python backend keeps SymPy in-process (no microservice overhead). React Native = one codebase for both platforms. Claude handles natural language evaluation/explanation while SymPy handles correctness.

**Key architectural note:** SymPy does not natively produce human-readable step-by-step solutions. `solve()` returns the answer, not the intermediate steps. The math engine uses a hybrid approach: Claude generates pedagogically correct step decompositions, and SymPy verifies the **final answer** for correctness. If the final answer doesn't match, Claude retries with corrective feedback. This avoids the fragility of parsing Claude's intermediate expressions back into SymPy for per-step verification. For v1 math scope (algebra-level), a correct final answer strongly implies correct intermediate steps. Spike this early to confirm reliability.

## Secrets & Configuration

**Local dev:** `.env` file (git-ignored) with all API keys and DB credentials.

**Required secrets:**
- `DATABASE_URL` - Postgres connection string
- `JWT_SECRET` - token signing key
- `CLAUDE_API_KEY` - Anthropic API
- `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` - OCR service (deferred to v2, not needed for launch)

**Approach:**
- `.env.example` checked into git with placeholder values (never real keys)
- `pydantic-settings` loads env vars with validation on startup - app fails fast if a key is missing
- `SENTRY_DSN` - Sentry error tracking (backend + mobile have separate DSNs)
- Production: Railway environment variables for secrets — injected as env vars, same code reads them. Migrate to AWS Secrets Manager if/when we move to AWS.
- Mobile: no secrets stored on device. All API keys live server-side only. Mobile talks to our API, never directly to Claude/Mathpix.

## Core Tutoring Loop

```
Input problem (typed text or word problem) → Parse to structured math (SymPy + Claude for word problems)
  → "What would you do first?" → Student responds
  → Step-size validation: reject answers that skip intermediate steps
    ("That's the right answer, but walk me through HOW you got there.")
  → LLM evaluates against correct step (from SymPy)
  → Correct: → randomly trigger explain-back (~30% of correct answers)
             → OR advance to next step
  → Wrong:  → explain why, offer hints (progressive: vague → specific)
           → Hint ceiling: hints give at most 80% of the step, never the full answer.
             Student must always contribute the final piece.
           → Max 3 attempts per hint level before escalating
           → still stuck? simplify explanation
           → "Explain this step in your own words"
           → LLM evaluates understanding:
               ✓ Clear    → generate similar problem to confirm → next step
               ~ Partial  → targeted follow-up ("What do we subtract?")
               ✗ Wrong    → re-explain differently, loop
```

**Anti-cheating & integrity:**
- **Step-size enforcement**: If a student's response skips steps (jumps from problem to answer), the system rejects it and asks them to show the intermediate work. This is the primary anti-cheating mechanism. **V1 approach:** define a maximum "step distance" heuristic (one operation per step). If the student's answer matches a step 2+ ahead in the solution, ask them to show intermediate work. Do not attempt to prove mathematical reachability — that's a research problem. Simple heuristic is sufficient for algebra-level v1 scope.
- **Hint ceiling**: The progressive hint system caps at ~80% of a step. The student must always contribute the final piece themselves. No hint ever gives away a complete step.
- **Attempt limits**: Max 5 attempts per step before the system scaffolds down (breaks the step into sub-steps) rather than revealing the answer.
- **Random explain-back on correct answers**: ~30% of correct answers trigger "explain in your own words" — not just after failures. This prevents students from associating explain-back with punishment and catches lucky guesses. Combined with step-size enforcement, this makes brute-forcing impractical.

**Session context:** Each LLM call receives the recent session history (last N exchanges) so the tutor can reference prior mistakes, recognize repeated errors, and build on previous explanations. e.g., "You made the same sign error again — remember what we said about distributing negatives?"

## LLM Modes (same model, different system prompts)
- **Evaluator**: Grade student response against SymPy's correct step. Must handle: correct answer with wrong method, partially correct responses, arithmetic errors in correct approach, skipped steps, equivalent expressions (`2/4` vs `1/2`)
- **Explainer**: Explain why something is right/wrong, calibrated to student's grade level
- **Prober**: Assess if student's own-words explanation shows real understanding. Uses rubric-style criteria:
  - ✓ **Clear**: Student identifies the operation, explains WHY it applies, and can state the result
  - ~ **Partial**: Student describes WHAT happened but not WHY (e.g., "I moved the 3" vs "I subtracted 3 from both sides to isolate x")
  - ✗ **Wrong**: Student's explanation contradicts the step or is incoherent

**Streaming:** All LLM responses are streamed to the client so students see explanations being "typed out" in real time. Waiting 1-3 seconds with no feedback feels broken — streaming solves this.

## Security & Compliance

**We handle student data — FERPA and COPPA compliance are non-negotiable for selling to schools.**

**Regulatory:**
- **FERPA**: We act as a "school official" under contract. Schools own the data. We must support data export and deletion on request.
- **COPPA**: Students under 13 require school/parental consent for data collection. Schools can provide consent on behalf of parents (FERPA exception) — document this flow.
- **Data Processing Agreement (DPA)**: Template needed before first school sale. Standard in edtech.
- **Privacy policy**: Clear language on what we collect, how it's used, and what goes to third parties.

**Data flow to third parties:**
- **Claude API**: Receives student text responses and math expressions. Anthropic does not train on API inputs. Document in privacy policy.
- **Mathpix API** (v2): Not used in v1. When added, receives photos of math problems. Risk: worksheet headers may contain student names/school info. Mitigation: crop to math region before sending, or strip metadata.
- No third party receives student identity (name, email). All calls are keyed to our API key, not student accounts.

**Application security:**
- **Auth**: bcrypt password hashing, JWT with short expiry + refresh tokens, brute force protection (account lockout after 5 failed attempts), password strength requirements
- **API**: HTTPS only, security headers (CORS, CSP, HSTS), request size limits (prevent large uploads), rate limiting per user, input sanitization on all endpoints
- **Database**: PII encryption at rest (student emails), Postgres TLS connections, parameterized queries via SQLAlchemy (prevents SQL injection)
- **Mobile**: No secrets on device, secure token storage (expo-secure-store)
- **LLM prompt injection**: Students could type adversarial input instead of math. Mitigations: validate LLM responses match expected schema, system prompts with strong guardrails, output filtering before returning to client
- **Data retention**: Define policy (e.g., session data retained for school year, deleted after). Support school-initiated data deletion requests.

## V1 Math Scope

**In scope for launch:** arithmetic, linear equations, quadratic equations, basic algebraic expressions (simplify, factor, expand), and word problems (translating natural language contexts into equations). Word problems are included because students rarely encounter naked equations — the translation from context to math is where most students struggle.

**Deferred to v2+:** calculus, trigonometry, geometry/proofs. Step-by-step decomposition for these is dramatically harder and the target market (schools) is well-served by algebra + word problems alone.

---

## PR-by-PR Build Order

### PR 1: Project Scaffolding
- Initialize React Native project (Expo)
- Initialize FastAPI backend with project structure
- Docker setup for local dev (Postgres, API)
- **Alembic** for database migrations (schema evolves across PRs 2, 6, 8, 9 — need migration tooling from day one)
- Basic CI (lint, type check)
- `.env.example` with all required keys, `pydantic-settings` config class with validation
- `.gitignore` covering `.env`, `__pycache__`, `node_modules`, etc.
- Security headers middleware (CORS, CSP, HSTS, X-Content-Type-Options)
- HTTPS enforcement, request size limits (10MB max for image uploads)
- **SSE streaming infrastructure**: FastAPI `StreamingResponse` with SSE for LLM response streaming — scaffold the pattern now so PRs 5/7 aren't blocked
- **KaTeX via WebView** for LaTeX rendering on mobile — more reliable cross-platform than `react-native-math-view` which has platform-specific bugs. This affects all math display UI downstream. **Note:** measure WebView spin-up latency — can be 200-500ms on older devices. Consider pre-warming the WebView on app launch.
- **API versioning**: prefix all routes with `/v1/` from day one. We're selling to schools — once they integrate, we can't break their API. Cheap insurance.
- **Structured logging & observability**: JSON structured logging with correlation IDs per session/request. Request tracing middleware that tags every log line with a `request_id`. This is essential for debugging LLM-dependent flows later ("why did the tutor say X?").
- **Mobile state management**: decide and document the approach. For this app's complexity, Zustand or React Context + useReducer is sufficient — Redux is overkill. Tutoring sessions have complex state (current step, history, streaming responses, network status, retry queues) so this decision affects every mobile PR downstream.
- **Database connection pooling**: SQLAlchemy async engine with connection pool configuration. Important under load — don't leave this to default settings.
- **Sentry integration (backend)**: error tracking + performance monitoring on FastAPI. Wire up early so every PR from here on has crash reporting. Free tier covers early stage.
- **Production hosting decision**: Railway. Postgres included, simple deploys from Docker, environment variable injection for secrets. Migrate to AWS (ECS/Fargate) later if scale demands it. No production setup yet — just document the decision so infra choices in later PRs are aligned.

**Structure:**
```
/mobile          → React Native (Expo) — student-facing
/web             → React admin panel — teacher dashboard (PR 9)
/api             → FastAPI
  /core          → math engine, LLM service
  /routes        → API endpoints
  /models        → DB models
  /schemas       → Pydantic request/response
  /config.py     → pydantic-settings, env var loading
  /alembic       → database migrations
/infra           → Docker, deploy configs
```

**Tests:** CI runs lint + type check. Smoke test that the API starts and returns health check on `/v1/health`. SSE streaming endpoint proof-of-concept. KaTeX rendering proof-of-concept on mobile (measure render latency). Alembic migration runs cleanly against empty DB. Structured logging outputs valid JSON with correlation IDs. Connection pool initializes correctly. Sentry captures a test exception in dev (verify DSN is wired correctly).

### PR 2: Auth & User Model
- PostgreSQL schema: users table (includes `grade_level` field, email encrypted at rest)
- Email/password registration & login (passwords hashed with bcrypt, password strength validation)
- JWT token auth (short-lived access tokens + refresh tokens)
- **Refresh token rotation with family detection**: store refresh tokens in DB with a `family_id`. On each refresh, issue a new refresh token and invalidate the old one. If a previously-used refresh token is reused (indicates theft), invalidate the entire token family. This prevents token replay attacks.
- Brute force protection: account lockout after 5 failed login attempts (cooldown period)
- FastAPI auth middleware
- Mobile: login/register screens with grade level selection, secure token storage (expo-secure-store)
- **Migration testing strategy**: test Alembic migrations both up *and* down, against a DB with seed data (not just empty). Add this to CI — schema evolves across PRs 2, 6, 8, 9 and migrations must be reversible.

**Tests:** Unit tests for registration, login, token validation, invalid credentials, expired tokens, duplicate email handling, brute force lockout triggers correctly, weak password rejection. Refresh token rotation: new token issued on refresh, old token rejected, reuse of old token invalidates entire family. Migration up/down tests with seed data.

### PR 3a: Math Engine - Parsing & Verification
- SymPy integration: parse expression/equation from string input
- Answer verification: given a problem and a proposed answer, verify correctness
- Expression equivalence checking (`2/4` == `1/2`, `x+1` == `1+x`)
- Similar problem generator: same structure, different numbers, same difficulty
- Support scope: arithmetic, linear equations, quadratics, algebraic expressions, word problems (LLM parses natural language → equation, SymPy verifies)

**Tests:** Unit tests for parsing, answer verification, equivalence checking, similar problem generation. Edge cases: division by zero, unsolvable equations, identity equations, very large numbers.

### PR 3b-spike: Step Decomposition Spike (time-boxed: 1-2 days)
- **Before committing to the full PR, validate the approach.** Test 5-10 problems per math domain (arithmetic, linear equations, quadratics, algebraic expressions, word problems).
- Claude generates full step-by-step solution → SymPy checks final answer only → measure: first-try pass rate, retry convergence rate, quality of intermediate steps.
- **Go/no-go criteria**: if final-answer match rate is >85% on first try and >95% after 1 retry, proceed with PR 3b. If not, pivot to hand-coded step templates for v1 scope (narrow enough to template).
- Document results and decision.

### PR 3b: Math Engine - Step-by-Step Decomposition
- **Simplified validation approach**: Claude generates full step-by-step breakdown, SymPy verifies **final answer only** (not each intermediate step). This avoids the fragility of parsing Claude's intermediate expressions back into SymPy.
- If final answer doesn't match SymPy's solution → feed the correct answer back to Claude and regenerate (max 3 retries)
- Step generation service: takes a problem → returns ordered list of steps
- Each step has: description, operation, before state, after state
- **Few-shot caching by problem structure**: cache key is problem type + structure (e.g., "linear, ax+b=c"). Cache stores **real decompositions** of previously solved problems of that structure, used as **few-shot examples in the prompt** — not as templates to instantiate. When a new problem comes in, the cached example is included in Claude's prompt ("Here's how we broke down a similar problem: [cached example]. Now decompose this one: ..."). Claude handles the translation naturally. New outputs are cached alongside existing examples. This avoids the fragility of template instantiation (Claude doesn't generate structurally identical steps for different numbers) while still improving quality, consistency, and retry rates.
- Fallback: if retries exhausted, log the failure and fall back to a simpler decomposition (fewer steps)

**Tests:** Golden set of **30 problems per math domain** (arithmetic, linear equations, quadratics, algebraic expressions, word problems = ~150 total) with expected final answers. Verify final answer matches SymPy for every problem. Spot-check intermediate step quality on a subset. Test few-shot caching behavior (same structure, different numbers → cached example included in prompt → higher quality output). Test retry path converges. Test fallback on exhausted retries.

**Note:** Risk is significantly reduced by the spike and final-answer-only validation. If quality issues appear in production, add an async second-Claude-instance verifier for intermediate steps (not on the critical path — runs after response is sent, logs disagreements for review).

### PR 4: Problem Input - Text
- Mobile: text input screen with math keyboard (fractions, exponents, etc.)
- API endpoint: receive text input → parse via math engine → return structured problem
- Error handling for unparseable input
- LaTeX rendering on mobile for displaying formatted math (using library from PR 1)

**Tests:** API integration tests (text in → structured problem out). Malformed input handling. Mobile component tests for math keyboard.

### PR 5: LLM Tutor Layer
- Claude API integration with three prompt modes (evaluator, explainer, prober)
- **Streaming support** for all LLM responses (Claude streaming API)
- **Retry & resilience**: exponential backoff (3 retries), 10s timeout per call, circuit breaker pattern (if Claude errors exceed threshold, fail fast for a cooldown period rather than queuing up requests). Don't wait for PR 10 — sessions depend on Claude from this PR onward.
- **LLM call logging & cost tracking**: log every LLM call with prompt hash, full response, latency, input/output token count, and estimated cost. Tag each call with `session_id` and `user_id`. This is essential for debugging ("why did the tutor say X?"), cost monitoring, and per-school usage reports.
- **Cost alerting**: global daily cost circuit breaker — if Claude API spend exceeds a configurable threshold, alert and optionally degrade (e.g., disable non-essential calls like explain-back). Schools will ask "how much will this cost us?" — token tracking makes this answerable.
- Evaluator: takes {correct_step, student_response} → returns {is_correct, feedback}
- Explainer: takes {step, error, grade_level} → returns streamed explanation
- Prober: takes {step, student_explanation} → returns {understanding_level, follow_up_question?}
- Grade level threaded through all prompts (from user profile)
- Prompt injection guardrails: system prompts resist adversarial student input, LLM responses validated against expected schema before returning to client
- Output filtering: strip any non-math content the LLM might generate (links, code, etc.)
- Prompt engineering + testing for each mode
- Response caching for common explanations

**Tests:** Structural tests (correct schema returned, `is_correct` set properly for obvious cases). Prompt injection tests (adversarial inputs return safe, on-topic responses). Retry tests (simulated Claude timeout → retry succeeds, circuit breaker trips after repeated failures). Token counting tests (verify token counts are logged per call). Golden set: ~20 curated student responses **per math domain** (arithmetic, linear equations, quadratics, algebraic expressions, word problems = ~100 total) with expected evaluations - run as a **warning** in CI (posts results to PR comment / dashboard), not blocking (LLM output isn't deterministic). This ensures prompt regressions from PR 5.5 are visible even if not blocking.

### PR 5.5: Prompt Tuning & Evaluation
- **Golden test generation tooling**: build a script that programmatically generates candidate student responses per problem type — correct answers, common errors (sign errors, arithmetic mistakes, skipped steps, equivalent expressions). Hand-label the generated cases rather than writing all 125+ from scratch.
- Expand golden test set to ~125+ cases (25+ per math domain, 5 domains) covering:
  - Correct answer, wrong method
  - Partially correct (right direction, arithmetic error)
  - Correct but skipped steps
  - Equivalent but differently expressed answers
  - Grade-level appropriate explanations (same error, different grade levels)
- Iterate on system prompts for each mode based on test results
- Document prompt versions and evaluation scores
- Establish quality baseline before building session orchestration

**Tests:** Full golden set pass rate documented. Minimum threshold: evaluator 90%+ accuracy on golden set, explainer produces grade-appropriate language, prober correctly distinguishes understanding levels.

### PR 6: Core Tutoring Session - Backend
- Session model: tracks problem, current step, attempts per step, conversation history, state
- Conversation context: store and pass recent exchanges (last N) to each LLM call
- API endpoints:
  - `POST /session` - start new session with problem
  - `POST /session/{id}/respond` - submit answer for current step (streamed response)
  - `GET /session/{id}` - get current session state
- Orchestration logic: math engine → LLM evaluation → determine next action
- **Step-size validation**: reject responses that skip intermediate steps. **V1 heuristic approach:** define a maximum "step distance" — each student response should represent at most one mathematical operation from the current state. If the student's answer matches a step 2+ ahead, reject and ask for intermediate work. Do not attempt to prove general reachability or handle arbitrary alternative orderings — that's a research problem. For v1 algebra scope, the heuristic of "one operation per step" covers the vast majority of cases. Edge cases (student combines two simple operations) are handled gracefully by the LLM evaluator, which can accept reasonable combinations with a note like "Good, but let's take it one step at a time."
- **Hint system**: track hint level per step, progressive reveal, **hard ceiling at 80%** — final hint gives strong guidance but never the complete answer
- **Attempt limits**: max 5 attempts per step, then scaffold down (break step into sub-steps)
- **Random explain-back**: ~30% of correct answers trigger "explain in your own words" (not just after hint sequences)
- "Explain in your own words" trigger after hint sequence
- Similar problem generation wired in (using generator from PR 3a)
- **Per-user daily request caps**: limit sessions/requests per user per day to control Claude API costs. Configurable per tier (free vs school-licensed). Ship cost protection with the session endpoint, not in polish phase.

**Tests:** Integration tests for the full flow: start session → correct answer advances → wrong answer triggers hints → hint escalation → explain-back trigger → similar problem generation. Test step-size validation rejects skipped steps (student jumps 2+ steps ahead). Test step-size validation accepts single-operation responses. Test hint ceiling never reveals full answer. Test attempt limit triggers scaffolding. Test random explain-back triggers on correct answers. Test session state persistence across requests. Test that conversation history is correctly passed to LLM. Test per-user daily request caps enforce limits and return appropriate errors.

### PR 7: Core Tutoring Session - Mobile
- Session UI: shows current step, input area, conversation history
- **Streaming display**: LLM responses appear word-by-word as they stream in (using SSE infrastructure from PR 1)
- Step-by-step flow with clear visual progress (which step you're on)
- Hint request button
- "Explain it back" prompt UI
- Similar problem interstitial (confirm mastery before advancing)
- Session complete / problem solved screen
- **Network resilience**: optimistic UI (show student's input immediately, "thinking" state while waiting), retry with exponential backoff on failed requests, graceful degradation on spotty connections (queue the request, show "reconnecting..." rather than error screens). Students on school buses with bad WiFi shouldn't see crashes.
- **Sentry integration (mobile)**: `@sentry/react-native` for crash reporting, JS error tracking, and performance monitoring. Captures unhandled exceptions, component render errors, and network failures. Pairs with backend Sentry (PR 1) for full-stack error visibility.

**Tests:** Component tests for key UI states (waiting for input, showing feedback, streaming response, hint display, session complete). Test network resilience (simulated timeout → retry succeeds, simulated offline → queued request sent on reconnect). Sentry captures a test error on mobile (verify DSN wired correctly). Manual QA walkthrough of full session flow.

### PR 8: Student Progress, History & Adaptive Difficulty
- DB schema: problem history, session results, mastery scores per topic
- Mastery tracking per concept/operation type (updated from session results and similar problem confirmations)
- **Adaptive difficulty**: use per-concept mastery scores to adjust next problem difficulty
  - High mastery (>80%) → increase complexity (harder numbers, more steps, compound operations)
  - Low mastery (<40%) → scaffold down (simpler numbers, fewer steps, break into sub-problems)
  - Medium → stay at current level
- API endpoints for progress data
- Mobile: history screen (past problems, how they were solved — hints used, attempts per step)
- Mobile: progress screen (mastery by topic)
**Tests:** Unit tests for progress/mastery calculations. Adaptive difficulty selects appropriate problem level based on mastery. API tests for history and progress endpoints. Integration test: mastery score updates correctly after session completion and similar problem confirmation.

### PR 9: Teacher Visibility (MVP)
- **Teacher role** in auth system (separate from student accounts)
- Teacher can create a "class" and generate join codes for students
- **Assignment mode**: teacher assigns specific problem types or topics to a class
- **Per-student session visibility**: teacher can see for each student:
  - Problems attempted and completed
  - Hints used per step, attempts per step
  - Whether explain-back was triggered and passed
- **Hint aggressiveness config**: teacher can adjust per-class (or per-student) settings for attempt limits before scaffolding (default 5) and hint ceiling percentage (default 80%). Some students need to struggle longer; some need faster support.
- **Class overview dashboard**: aggregate stats — common problem areas, average attempts, topic mastery distribution
- API endpoints for all teacher data (read-only views of student progress)
- **Web-only dashboard** (React admin panel) — teachers use laptops, not phones. Faster to build and iterate than mobile screens. Mobile app remains student-only for v1.

**Tests:** Auth tests for teacher role separation (teachers can't access student sessions as a student, students can't access teacher dashboard). Join code generation and redemption. Assignment creation and student visibility. Hint aggressiveness config applies correctly to student sessions.

### PR 10: Polish, Edge Cases & Launch Prep
- Graceful handling of LLM errors beyond retry exhaustion (fallback to showing hint text or "tutor is temporarily unavailable, here's the next hint")
- Offline detection + messaging
- Loading states, animations, transitions
- Error boundaries on mobile
- Rate limiting on API (per-user and global)
- Input sanitization on all endpoints
- Security audit checklist: review all endpoints for auth, injection, data leaks
- Privacy policy draft & DPA template (needed before school sales)
- Data retention policy implementation: auto-cleanup of old sessions, school deletion API
- App store assets, metadata
- Basic analytics events (session started, completed, step attempts) — no PII in analytics
- Load testing on API
- **Per-school usage reports**: aggregate token usage and cost data (from PR 5 logging) into per-school reports. Schools need to know their usage for budgeting.
- **Railway production deployment**: staging + production environments, Docker-based deploys, environment variable configuration for all secrets, deploy pipeline (push-to-deploy from main branch). Railway's managed Postgres for both environments.
- **Automated database backups**: enable Railway's automated daily Postgres backups. Document and test the restore procedure (restore runbook). FERPA requires we can recover school data — this must be tested before launch, not just enabled.

**Tests:** Edge case tests (LLM retry exhaustion fallback, malformed data handling, rate limit responses). Security tests: unauthorized access attempts, SQL injection attempts, oversized payloads. End-to-end smoke test of complete user flow. Load test results documented. Database backup restore tested against staging (restore from backup, verify data integrity).

---

## Future Feature Considerations
- **Photo/OCR input**: camera capture + Mathpix API integration (image → LaTeX → structured math), confidence threshold handling, EXIF stripping, crop to math region to prevent leaking student names from worksheet headers
- **Calculus & trig support**: extend math engine for derivatives, integrals, trig identities
- **Teacher-authored problems**: allow teachers to input their own problems (paste from worksheets, custom problem sets) rather than only selecting from predefined problem types/topics
- **Standards alignment**: tag problems and mastery tracking to Common Core / state standards — critical for admin buy-in and curriculum alignment when selling to schools
- **Teacher dashboard (full)**: exportable progress reports (for parent conferences, IEP meetings, admin reporting), assignment grading integration
- **Learn mode**: built-in curriculum/problem sets by topic and grade level
- **School SSO**: Google, Clever, ClassLink integration (auth model supports adding OAuth providers)
- **Multi-language support**: i18n for UI + LLM explanations in student's language
- **Offline mode**: cache math engine for offline solving, queue LLM calls for when back online
- **Accessibility**: text-to-speech, large fonts, colorblind themes, screen reader support
- **Geometry/proofs**: visual canvas, multi-path proof validation
- **Graphing**: visual rendering of functions, interactive graph manipulation
- **Integrity flags**: track suspicious patterns per student (always wrong first try then correct second, rapid-fire guessing) for teacher dashboard visibility. V1's step-size enforcement + random explain-back already make gaming impractical — explicit flagging can wait.
