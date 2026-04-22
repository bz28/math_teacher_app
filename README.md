# Veradic AI

An AI-powered tutoring app that teaches students how to solve math and chemistry problems step-by-step through guided problem-solving, not by giving answers. Built with React Native (mobile), Next.js (web), and FastAPI (backend).

## What It Does

Students snap a photo of their homework or type a problem. The app breaks it into steps and guides them through each one with an interactive AI tutor they can chat with at any point. After learning, students can generate unlimited similar problems to practice, or take timed mock exams.

## App Modes

### Learn Mode
- AI breaks problems into ordered solution steps
- Students work through each step with guidance
- Chat with the AI tutor anytime — ask questions about any step
- After completing a problem, practice similar ones or flag for review

### Mock Test Mode
- Input problems manually, scan a worksheet, or generate similar questions from a seed problem
- Timed or untimed exam simulation with free navigation between questions
- Submit handwritten work photos for AI diagnosis
- Review results and learn flagged problems in Learn mode

## Features

- **Photo scanning** — Take a photo or pick from gallery; AI extracts multiple problems automatically
- **Problem queue** — Queue up to 10 problems from photos or text input
- **Generate similar problems** — One problem generates unlimited practice variations
- **Work submission** — Attach photos of handwritten work for AI diagnosis and feedback
- **Interactive AI tutor** — Ask questions about any step during a session
- **Step-by-step learning** — Problems decomposed into teachable steps with hints
- **Mock exams** — Timed tests with configurable settings
- **Session history** — Review past sessions, resume unfinished ones
- **Multi-subject** — Mathematics and Chemistry

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Zustand, Framer Motion |
| Mobile | React Native (Expo 54), TypeScript, Zustand |
| Backend | FastAPI (Python), SQLAlchemy, Alembic |
| AI | Claude API (Anthropic) |
| Database | PostgreSQL |
| Auth | JWT + refresh token rotation, bcrypt |
| Monitoring | Sentry (backend + mobile, optional) |

## Project Structure

```
web/                    # Next.js website (veradicai.com)
  src/
    app/                # App Router pages
      (app)/            # Authenticated app routes (home, learn, mock-test, history)
      (marketing)/      # Public pages
      login/            # Login page
      register/         # Registration page
    components/         # UI components
      ui/               # Primitives (Button, Card, Input, Modal, Badge, Skeleton)
      landing/          # Landing page sections
      auth/             # Auth provider and guard
      shared/           # App layout, image upload, work diagnosis
    lib/                # API client, utilities
    stores/             # Zustand stores (auth, session)
    styles/             # Design tokens

mobile/                 # React Native app (Expo)
  src/
    components/         # Screens and UI components
    services/api.ts     # Backend API client
    stores/             # Zustand state management
    hooks/              # Custom hooks (image extraction)
    theme.ts            # Design system

api/                    # FastAPI backend
  core/                 # Business logic
  routes/               # API endpoints
  models/               # SQLAlchemy models
  schemas/              # Pydantic request/response schemas
  alembic/              # Database migrations
  middleware/           # Auth, logging, rate limiting

dashboard/              # Admin web dashboard (React + Vite)
plans/                  # Feature planning documents
tests/                  # Backend test suite
```

## Deployment

### Architecture

```
                    ┌─────────────────────┐
  veradicai.com ──> │   Vercel (Web)      │
                    │   Next.js 16        │
                    └────────┬────────────┘
                             │ API calls
                             v
                    ┌─────────────────────┐     ┌──────────────┐
                    │   Railway (API)     │────>│  Railway      │
                    │   FastAPI + Python  │     │  PostgreSQL   │
                    └─────────────────────┘     └──────────────┘
                             ^
                             │ API calls
                    ┌────────┴────────────┐
                    │   Expo (Mobile)     │
                    │   React Native      │
                    └─────────────────────┘
```

### Production URLs

| Service | URL |
|---------|-----|
| Website | https://math-teacher-app-eight.vercel.app (custom domain: veradicai.com) |
| Backend API | https://mathteacherapp-production.up.railway.app/v1 |
| Database | Railway PostgreSQL (internal) |

### Website (Vercel)

The Next.js web app is deployed on Vercel with automatic deploys from `main`.

**Setup:**
1. Import repo on [vercel.com/new](https://vercel.com/new)
2. Set **Root Directory** to `web`
3. Framework is auto-detected as Next.js
4. Add environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://mathteacherapp-production.up.railway.app/v1`
   - `NEXT_PUBLIC_SITE_URL` = `https://veradicai.com`
5. Deploy

**Important:** `NEXT_PUBLIC_` env vars are baked in at build time. If you change them, you must redeploy (with build cache disabled) for the change to take effect.

**Custom domain:** In Vercel project Settings > Domains, add `veradicai.com`. Then add the DNS records Vercel provides at your domain registrar (Spaceship).

### Backend API (Railway)

The FastAPI backend runs on Railway with automatic deploys from `main`.

**Setup:**
1. Create a new project on [railway.com](https://railway.com)
2. Add a **PostgreSQL** database to the project
3. Add a **GitHub service** connected to this repo
4. In the service **Settings**:
   - **Build Command:** `pip install -e "."`
   - **Start Command:** `pip install -e "." && python -m alembic upgrade head && python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT`
   - (The start command re-installs dependencies because Railway's build and deploy environments are separate)
5. In the service **Variables**, add:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://...` | Railway Postgres URL with `+asyncpg` prefix |
| `JWT_SECRET` | random string | Secret for signing auth tokens |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime |
| `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh token lifetime |
| `CLAUDE_API_KEY` | `sk-ant-...` | Anthropic API key |
| `APP_ENV` | `production` | Environment name |
| `LOG_LEVEL` | `INFO` | Logging level |
| `SENTRY_DSN` | (empty) | Sentry DSN, leave empty to disable |
| `DAILY_COST_LIMIT_USD` | `50.0` | Daily LLM spend alert threshold |
| `CORS_ORIGINS` | `["https://math-teacher-app-eight.vercel.app","https://veradicai.com","http://localhost:3000"]` | Allowed origins for CORS |

**Important:** The `DATABASE_URL` from Railway uses `postgresql://` but this app requires `postgresql+asyncpg://`. When copying the URL from the Postgres service, change the prefix.

6. Generate a public domain in Settings > Networking

### CORS

The backend must allow requests from all frontend origins. Update the `CORS_ORIGINS` variable on Railway when adding new domains:
- `https://veradicai.com` — production website
- `https://math-teacher-app-eight.vercel.app` — Vercel deployment
- `http://localhost:3000` — local web development
- `http://localhost:8081` — local mobile development

### Mobile (Expo)

Mobile builds are managed through Expo EAS. The mobile app connects to the same backend API.

## Local Development

### Prerequisites
- Node.js 20+
- Python 3.12+
- PostgreSQL (or Docker)
- pnpm (for web)

### Backend

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Copy environment variables
cp .env.example .env
# Edit .env with your database URL, Claude API key, etc.

# Start PostgreSQL (if using Docker)
docker compose up -d postgres

# Run database migrations
python -m alembic upgrade head

# Start the server
python -m uvicorn api.main:app --reload --port 8000
```

### Web

```bash
cd web
pnpm install
pnpm dev
# Opens at http://localhost:3000
# API defaults to http://localhost:8000/v1

# To point at production backend instead:
NEXT_PUBLIC_API_URL=https://mathteacherapp-production.up.railway.app/v1 pnpm dev
```

### Mobile

```bash
cd mobile
npm install
npx expo start
```

### Running Tests

```bash
# Backend tests
pytest tests/ -v -m "not integration"

# Web build + lint check
cd web && pnpm build && pnpm lint

# Mobile type check
cd mobile && npx tsc --noEmit
```

### Running Migrations

```bash
# Apply all pending migrations
python -m alembic upgrade head

# Create a new migration after model changes
python -m alembic revision --autogenerate -m "description of change"
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string (must use `+asyncpg` driver) |
| `CLAUDE_API_KEY` | Anthropic API key for AI features |
| `JWT_SECRET` | Random secret for signing auth tokens |
| `SENTRY_DSN` | Sentry error tracking (optional, leave empty to disable) |
| `APP_ENV` | `development` or `production` |
| `CORS_ORIGINS` | JSON array of allowed frontend origins |

## API Overview

All routes are prefixed with `/v1/`.

| Endpoint | Description |
|----------|------------|
| `POST /auth/register` | Register (email, password, name, grade) |
| `POST /auth/login` | Login |
| `POST /auth/refresh` | Refresh access token |
| `GET /auth/me` | Current user info |
| `POST /session` | Create tutoring session |
| `POST /session/{id}/respond` | Submit answer or ask question |
| `GET /session/history` | List past sessions |
| `POST /session/{id}/similar` | Generate a similar problem |
| `POST /session/mock-test` | Create mock test session |
| `POST /session/mock-test/{id}/complete` | Submit mock test results |
| `POST /practice/generate` | Generate similar practice problems |
| `POST /practice/check` | Check a practice answer |
| `POST /image/extract` | Extract problems from photo |
| `POST /work/submit` | Submit work photo for diagnosis |
