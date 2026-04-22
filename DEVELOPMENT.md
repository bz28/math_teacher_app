# Local Development

## Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL 16 (or Docker)

## Quick Start (Docker)

```bash
# 1. Copy env file and add your Claude API key
cp .env.example .env
# Edit .env → set CLAUDE_API_KEY

# 2. Start Postgres + API
docker-compose -f infra/docker-compose.yml up

# 3. Run migrations (in another terminal)
alembic upgrade head

# 4. Start the mobile app
cd mobile && npm install && npm start

# 5. Start the admin dashboard (optional)
cd dashboard && npm install && npm run dev
```

## Manual Setup (without Docker)

### 1. Backend (FastAPI)

```bash
# Create and activate virtualenv
python3.12 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Copy env and configure
cp .env.example .env
# Edit .env → set CLAUDE_API_KEY and DATABASE_URL

# Start Postgres (if not using Docker)
# Create database: mathapp, user: mathapp, password: mathapp

# Run migrations
alembic upgrade head

# Start the server
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at http://localhost:8000/docs

### 2. Mobile App (React Native + Expo)

```bash
cd mobile
npm install
npm start
```

- `npm run ios` — iOS simulator
- `npm run android` — Android emulator
- `npm run web` — Browser

### 3. Admin Dashboard (React + Vite)

```bash
cd dashboard
cp .env.example .env   # VITE_API_URL=http://localhost:8000/v1
npm install
npm run dev            # http://localhost:5173
```

## Database Migrations

```bash
alembic upgrade head                              # Apply all
alembic revision --autogenerate -m "description"  # Create new
alembic downgrade -1                              # Rollback one
alembic current                                   # Show current
```

## Testing

```bash
# Unit tests only (skip integration tests that hit Claude and cost money)
pytest tests/ -v -m "not integration"

# Integration tests (requires CLAUDE_API_KEY, costs money)
pytest tests/ -v -m integration

# With coverage
pytest tests/ --cov=api
```

## Linting & Type Checking

```bash
ruff check api/ tests/       # Lint
ruff format api/ tests/      # Auto-format
mypy api/ --ignore-missing-imports  # Type check
```

## Environment Variables

See `.env.example` for all options. The required ones:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Random secret for auth tokens |
| `CLAUDE_API_KEY` | Anthropic API key |
