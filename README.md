# Veradic

Veradic is an AI math-education **school portal**. A student photographs their handwritten homework; the platform reads the work, grades every problem with a written "receipt," runs a short conversational understanding-check to catch the student who got the right answer without really understanding, and hands the teacher a class they can see at a glance — graded, with the few students who need attention surfaced first. It serves three audiences from one codebase: **students** (school-enrolled and independent learners), **teachers** (courses, assignments, grading, analytics), and **schools/districts** (the institutions teachers belong to). Alongside the class workflow it keeps a self-study loop — Learn, Practice, and Mock-test — for individual learners.

> This README is a map of the codebase. Product and customer context lives in [`docs/product/overview.md`](docs/product/overview.md).

## The parts

### Web — `web/` (Next.js, veradicai.com)
The primary product surface **and** the marketing site, one Next.js 16 App Router app (React 19, TypeScript, Tailwind v4, Zustand, Framer Motion, KaTeX).
- **Public / marketing**: landing (`/`), `/students`, `/for-districts`, `/demo` (request-a-demo), `/subjects/{math,physics,chemistry}`, and legal pages under `(legal)/` (`/privacy`, `/terms`, `/support`, `/trust`).
- **Auth**: `/login`, `/register`, `/set-password`, `/invite` (section join).
- **Student app** (`(app)/`): `/home`, self-study `/learn` + `/practice` + `/mock-test` + `/review` + `/history`, and the classroom surface under `/school/student/*` (courses, homework, per-assignment practice, grades, practice-history).
- **Teacher portal**: `/school/teacher/*` — courses, units, sections, assignments/homework, per-section grade review, per-student drill-down.
- **Billing**: `/pricing` (Stripe checkout).

### Mobile — `mobile/` (Expo / React Native)
The student-facing native app (Expo 54, React Native 0.81, TypeScript, Zustand, KaTeX via WebView). App name/slug **Veradic**. Two tab sets chosen at login:
- **Personal learner**: Solve (photo → extract → learn), History, Review (weak spots), Account.
- **School student**: Home, Grades, Study/Practice, Account — plus Join-class, Homework, and the Integrity understanding-check chat.
- IAP via RevenueCat; generates its typed API client from `openapi.json` (`npm run gen:api`).

### Demo — `demo/` (standalone Vite pitch site, demo.veradicai.com)
A zero-auth, zero-API static React SPA (Vite 7, React Router) for sales/founder presentations. A front-door hub (`/`) plus a full-screen **present** mode (`/present`) with the four flagship stories, in pitch order: **integrity** (understanding), **grading**, **generation**, **teacher-day**. Content is bundled JSON captured from the live product / evaluation harness — no live calls.

### Admin dashboard — `dashboard/` (Vite / React ops console)
Internal ops + sales + AI-quality console (Vite 7, React Router, Recharts). Default landing is **Leads**. Areas: Leads / Lead detail, Schools / School detail, Independent students & teachers, Teacher detail, Admins (invite), Audit logs, and diagnostics — **LLM calls**, **Harness runs**, **Quality**, **Grading quality**, **Golden set**, and per-submission trace. Its own admin JWT auth.

### Backend — `api/` (FastAPI + Postgres)
FastAPI (Python 3.12, SQLAlchemy 2 async, Alembic, asyncpg) serving everything under `/v1`. Anthropic Claude for all AI. Auth is JWT + refresh-token rotation (bcrypt, email-OTP MFA, brute-force lockout).
- **Data model** (`api/models/`): users (roles: student / teacher / admin); schools (institutional vs individual/indie-teacher) → courses → units → sections → enrollments/invites; assignments → submissions → grades; integrity-check submissions/problems/conversation-turns; question bank + generation jobs; self-study sessions; practice activity; billing (Stripe events, subscriptions); and ops tables (contact leads, lead notes/meetings, LLM calls, harness runs, quality scores, audit logs).
- **Endpoint groups** (`api/routes/`, mounted in `api/main.py`): `auth`, `session` (learn/practice/mock-test), `practice`, `image` (extraction), `work` (work diagnosis), `integrity_check`, `weak_spots`, `teacher/*` (courses, sections, units, assignments, grades, documents, question-bank, practice-activity, preview, visibility), `school_student_practice`, `billing` + `webhook`, `contact`, and `admin/*` (leads, schools, users, overview, quality, grading-quality, harness, llm) + `admin_audit_logs`.
- **AI core** (`api/core/`): step decomposition, tutor, grading (`grading_ai`), integrity (`integrity_ai` + `integrity_pipeline`), document vision + image extraction, assignment/question-bank generation, an LLM judge, subjects, a geometry figure engine, cost tracking + LLM logging.

### Harness & improver — `tests/harness/`
An autonomous browser harness (Playwright + cached Chromium, token injection, isolated seed, cassette `$0` replay, cost tracker) that drives the **real running app** to test AI-generated surfaces (figures, solutions, grading). On top of it sits the **autonomous improver**: it scans the app, produces ranked/deduped improvement proposals, and — on approval — implements, reviews, and opens a PR. The route catalog it walks lives in `tests/harness/improver/surfaces.py`. See [`tests/harness/improver/README.md`](tests/harness/improver/README.md).

## Run it

Prerequisites: Python 3.12+, Node 20+, PostgreSQL 16 (or Docker), and `pnpm` for `web/` (npm for mobile/demo/dashboard). Full detail in [`DEVELOPMENT.md`](DEVELOPMENT.md).

```bash
# Backend (FastAPI) — http://localhost:8000  (docs at /docs)
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # set CLAUDE_API_KEY, DATABASE_URL, JWT_SECRET
docker compose -f infra/docker-compose.yml up -d db   # or your own Postgres
alembic upgrade head
uvicorn api.main:app --reload --port 8000

# Web (Next.js) — http://localhost:3000
cd web && pnpm install && pnpm dev

# Mobile (Expo) — http://localhost:8081 / simulator
cd mobile && npm install && npm start      # npm run ios | android | web

# Demo (Vite) — http://localhost:4173 (preview) / 5173 (dev)
cd demo && npm install && npm run dev

# Admin dashboard (Vite) — http://localhost:5173
cd dashboard && npm install && npm run dev   # set VITE_API_URL=http://localhost:8000/v1
```

Tests & checks: `pytest tests/ -m "not integration"` (unit), `ruff check api/ tests/`, `mypy api/`. AI-surface harness: `python -m tests.harness for-diff` (replay is `$0`).

## Architecture

```
  Students ──▶ mobile/ (Expo)  ─┐
              web/ (Next.js) ───┼──▶  api/ (FastAPI, /v1)  ──▶  PostgreSQL
  Teachers ──▶ web/ (Next.js) ──┘            │
                                             ├──▶  Anthropic Claude  (grading, integrity,
  Ops/sales ─▶ dashboard/ (Vite) ────────────┘        tutoring, generation, judge)
                                             ├──▶  Stripe (web) / RevenueCat (mobile)  — billing
  Sales ─────▶ demo/ (Vite SPA, no API) ──▶ bundled JSON (self-contained)
```

**Deploy targets:** the three frontends — web/marketing (`veradicai.com`), demo (`demo.veradicai.com`), and the admin dashboard (`admin.veradicai.com`) — deploy on **Vercel**; the **FastAPI backend and PostgreSQL run on Railway**. The repo also carries a local Docker stack (`infra/docker-compose.yml` + `infra/Dockerfile`) for development. Mobile ships via Expo/EAS.
