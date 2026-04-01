#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# worktree-dev.sh — Bootstrap and start dev servers in a git worktree
#
# Usage:
#   ./scripts/worktree-dev.sh [worktree-path]
#
# If no path is given, it uses the current directory.
# Automatically finds open ports so multiple worktrees can run simultaneously.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Resolve paths ────────────────────────────────────────────────────────────

WORKTREE="${1:-.}"
WORKTREE="$(cd "$WORKTREE" && pwd)"

# Find the main repo (the root git dir, not a worktree)
MAIN_REPO="$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null | sed 's|/\.git$||')"
if [[ -z "$MAIN_REPO" ]]; then
  echo "❌ Not a git repository: $WORKTREE"
  exit 1
fi

BRANCH="$(git -C "$WORKTREE" branch --show-current)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Worktree: $WORKTREE"
echo "  Branch:   $BRANCH"
echo "  Main:     $MAIN_REPO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Find an open port ────────────────────────────────────────────────────────

find_open_port() {
  local port=$1
  while lsof -iTCP:"$port" -sTCP:LISTEN &>/dev/null; do
    port=$((port + 1))
  done
  echo "$port"
}

API_PORT=$(find_open_port 8000)
DASH_PORT=$(find_open_port 5173)

# ── Step 1: Symlink .env files ───────────────────────────────────────────────

echo ""
echo "🔗 Linking .env files..."

# Root .env (backend config)
if [[ ! -f "$WORKTREE/.env" && -f "$MAIN_REPO/.env" ]]; then
  ln -s "$MAIN_REPO/.env" "$WORKTREE/.env"
  echo "   ✓ .env → main repo"
else
  echo "   · .env already exists"
fi

# Dashboard .env (needs dynamic API port)
mkdir -p "$WORKTREE/dashboard"
echo "VITE_API_URL=http://localhost:${API_PORT}/v1" > "$WORKTREE/dashboard/.env"
echo "   ✓ dashboard/.env (API port: $API_PORT)"

# ── Step 2: Symlink .venv ────────────────────────────────────────────────────

echo ""
echo "🐍 Linking Python venv..."

if [[ ! -d "$WORKTREE/.venv" && -d "$MAIN_REPO/.venv" ]]; then
  ln -s "$MAIN_REPO/.venv" "$WORKTREE/.venv"
  echo "   ✓ .venv → main repo"
else
  echo "   · .venv already exists"
fi

# ── Step 3: Install node_modules ─────────────────────────────────────────────

echo ""
echo "📦 Installing dependencies..."

for dir in dashboard web mobile; do
  if [[ -f "$WORKTREE/$dir/package.json" && ! -d "$WORKTREE/$dir/node_modules" ]]; then
    echo "   📦 $dir: npm install..."
    (cd "$WORKTREE/$dir" && npm install --silent 2>&1 | tail -1)
    echo "   ✓ $dir"
  else
    if [[ -f "$WORKTREE/$dir/package.json" ]]; then
      echo "   · $dir: node_modules exists"
    fi
  fi
done

# ── Step 4: Start servers ────────────────────────────────────────────────────

echo ""
echo "🚀 Starting servers..."

# Activate venv and start backend
(
  cd "$WORKTREE"
  source .venv/bin/activate
  PYTHONPATH="$WORKTREE:$PYTHONPATH" uvicorn api.main:app --reload --port "$API_PORT" &
)

# Start dashboard
(
  cd "$WORKTREE/dashboard"
  npx vite --port "$DASH_PORT" &
)

# Wait a moment for servers to start
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ All servers running!"
echo ""
echo "  Backend API:      http://localhost:${API_PORT}"
echo "  API Docs:         http://localhost:${API_PORT}/docs"
echo "  Admin Dashboard:  http://localhost:${DASH_PORT}"
echo ""
echo "  Branch: $BRANCH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all servers."

# Wait for all background jobs — Ctrl+C kills them all
trap 'echo ""; echo "🛑 Stopping servers..."; kill $(jobs -p) 2>/dev/null; exit 0' INT TERM
wait
