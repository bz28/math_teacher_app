#!/usr/bin/env bash
# Upsert THE single living "Improver backlog" issue.
#
# Both improver channels (UI scan + prod LLM-defect scan) write to one shared
# proposal queue, so `improve digest` renders the whole open backlog. Filing a
# fresh dated issue every run spread that one backlog across a pile of issues
# that never closed. Instead we keep ONE issue and rewrite its body in place,
# so unfixed proposals carry forward and nothing is forgotten.
#
# Body is read from stdin. Requires `gh`, GH_TOKEN, and the GitHub Actions
# defaults GITHUB_REPOSITORY / GITHUB_REPOSITORY_OWNER. Never fails the run:
# a transient API error must not sink the scan that produced the proposals.
#
# Optional ALERT_BODY env: a broken-user-journey alert. The issue BODY is
# rewritten in place every run (and BOTH channels overwrite it), so an alert
# placed in the body would be clobbered by the next channel's run. An alert is
# an EVENT, not backlog state — so it's posted as a COMMENT instead (comments
# are append-only). To avoid re-pinging the same breakage every 6h, we skip it
# when it's identical to the issue's most recent comment.
set -uo pipefail

TITLE="Improver backlog"
BODY="$(cat)"
ALERT_BODY="${ALERT_BODY:-}"

# Self-heal the label so a fresh repo (or a deleted label) can't drop the issue.
gh label create improver --color 5319e7 \
  --description "Autonomous improver proposals" 2>/dev/null || true

# Find the existing open backlog issue by exact title (most recent wins if a
# race ever produced two). Empty when none exists yet.
NUM="$(gh issue list --repo "$GITHUB_REPOSITORY" --label improver --state open \
  --search "$TITLE in:title" --json number,title \
  --jq "map(select(.title==\"$TITLE\")) | .[0].number // empty" 2>/dev/null || true)"

if [ -n "$NUM" ]; then
  gh issue edit "$NUM" --repo "$GITHUB_REPOSITORY" --body "$BODY" >/dev/null \
    && echo "refreshed backlog issue #$NUM" || echo "backlog refresh skipped"
else
  # Create, then assign best-effort: a bot-filed unassigned issue is silent
  # under the default watch setting, so assign the owner to notify them — but
  # never let an assign failure drop the whole issue.
  URL="$(gh issue create --repo "$GITHUB_REPOSITORY" \
    --title "$TITLE" --label improver --body "$BODY")" \
    || { echo "backlog create skipped"; exit 0; }
  echo "created backlog issue $URL"
  NUM="${URL##*/}"  # trailing path segment is the issue number
  gh issue edit "$URL" --repo "$GITHUB_REPOSITORY" \
    --add-assignee "$GITHUB_REPOSITORY_OWNER" 2>/dev/null || true
fi

# Broken-journey alert → comment (not body, which gets overwritten). Skip when
# it repeats the latest comment so a persistent breakage doesn't ping every run.
if [ -n "$ALERT_BODY" ] && [ -n "${NUM:-}" ]; then
  LAST="$(gh issue view "$NUM" --repo "$GITHUB_REPOSITORY" \
    --json comments --jq '.comments[-1].body // ""' 2>/dev/null || true)"
  if [ "$LAST" = "$ALERT_BODY" ]; then
    echo "alert unchanged since last comment — not re-pinging"
  else
    gh issue comment "$NUM" --repo "$GITHUB_REPOSITORY" --body "$ALERT_BODY" >/dev/null \
      && echo "posted broken-journey alert to #$NUM" || echo "alert comment skipped"
  fi
fi
