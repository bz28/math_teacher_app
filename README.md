# Math Tutor

An AI-powered math tutoring app that teaches students how to solve problems step-by-step through guided problem-solving, not by giving answers. Built with React Native (mobile) and FastAPI (backend).

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
- **Personalized greeting** — App greets students by name

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo 54), TypeScript, Zustand |
| Backend | FastAPI (Python), SQLAlchemy, Alembic |
| AI | Claude API (Anthropic) |
| Database | PostgreSQL |
| Auth | JWT + refresh token rotation, bcrypt, expo-secure-store |
| Monitoring | Sentry (backend + mobile) |
| Hosting | Railway (production) |

## Project Structure

```
mobile/                 # React Native app (Expo)
  src/
    components/         # Screens and UI components
    services/api.ts     # Backend API client
    stores/session.ts   # Zustand state management
    hooks/              # Custom hooks (image extraction)
    theme.ts            # Design system (colors, typography, spacing)
  App.tsx               # Root component and navigation

api/                    # FastAPI backend
  core/                 # Business logic
    session.py          # Tutoring session management
    practice.py         # Similar problem generation
    work_diagnosis.py   # Handwritten work analysis
    tutor.py            # AI tutor responses
    step_decomposition.py # Problem decomposition
    auth.py             # Authentication logic
    llm_client.py       # Claude API wrapper
  routes/               # API endpoints
  models/               # SQLAlchemy models
  schemas/              # Pydantic request/response schemas
  alembic/              # Database migrations
  middleware/           # Auth, logging, rate limiting

dashboard/              # Admin web dashboard (React)

plans/                  # Feature planning documents
tests/                  # Backend test suite
```

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.12+
- PostgreSQL
- Expo CLI (`npm install -g expo-cli`)

### Backend Setup

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt  # or check pyproject.toml

# Copy environment variables
cp .env.example .env
# Edit .env with your database URL, Claude API key, etc.

# Run database migrations
.venv/bin/alembic upgrade head

# Start the server
uvicorn api.main:app --reload
```

### Mobile Setup

```bash
cd mobile
npm install

# Start Expo dev server
npx expo start
```

### Running Migrations

```bash
# Apply all pending migrations
.venv/bin/alembic upgrade head

# Create a new migration after model changes
.venv/bin/alembic revision --autogenerate -m "description of change"

# Check current migration status
.venv/bin/alembic current
```

### Running Tests

```bash
# Backend tests
cd api && python -m pytest tests/ -v

# Mobile type checking
cd mobile && npx tsc --noEmit
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `CLAUDE_API_KEY` | Anthropic API key |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `SENTRY_DSN` | Sentry error tracking (optional) |
| `APP_ENV` | `development` or `production` |

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
| `POST /session/{id}/similar` | Generate a similar problem |
| `POST /session/mock-test` | Create mock test session |
| `POST /session/mock-test/{id}/complete` | Submit mock test |
| `POST /practice/generate` | Generate similar practice problems |
| `POST /practice/check` | Check a practice answer |
| `POST /image/extract` | Extract problems from photo |
| `POST /work/submit` | Submit work photo for diagnosis |

## Architecture Decisions

- **No secrets on mobile** — All API keys on the backend. Mobile only talks to FastAPI.
- **Claude for everything** — Step decomposition, answer checking, hint generation, work diagnosis, similar problem generation. No separate math engine.
- **JWT with refresh rotation** — Short-lived access tokens + refresh tokens with family-based reuse detection.
- **Zustand for state** — Lightweight state management for complex session flows (learn queue, practice batch, mock test).
- **SSE streaming** — LLM responses streamed word-by-word to mobile for responsive feel.

## Deployment

The backend is deployed on Railway with automatic deployments from the `main` branch. Migrations run automatically on deploy.

Mobile builds are managed through Expo EAS.
