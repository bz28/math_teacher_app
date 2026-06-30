---
name: autonomous-loop
description: Run the autonomous world-class improvement loop — ideate → plan → build → cold-review → test → iterate → merge → next. Use when the user says "run the loop", "autonomous", "keep improving", "/autonomous-loop", or grants full autonomy to keep shipping world-class work while they're away.
metadata:
  author: veradic
  version: "1.0.0"
  argument-hint: "[optional: a roadmap or focus area; omit to continue the standing roadmap]"
---

# Autonomous Loop

Run a continuous, self-directed loop that ships **world-class** work without waiting for human input at each step. The bar is not "functional" — it is **world-class across every surface, persona, and detail**. Never let "functional but not amazing" ship; if something is merely good enough, send it back through the loop.

The loop: **ideate → plan → build → cold-review → test → iterate → merge → next.**

## 0. Standing principles (apply throughout)

- **Ground every claim in the actual code before acting.** Roadmaps, memories, and prior turns go stale. Before building anything, verify it isn't already shipped: `git show origin/main:<path>`, `gh pr list`, grep the tree. Do **not** rebuild what already exists — a stale roadmap item that's already merged is *done*, not a task.
- **World-class bar.** Every surface gets the full ideate→build→review→test→iterate treatment. A prompt edit is the last resort for AI-surface bugs — hunt the deterministic root cause first (inputs → call → post-processing → render).
- **Verify, don't trust.** Treat audit/subagent findings as hypotheses; confirm against code before acting on or reporting them. Product-behavior questions are for the user, not defects to "fix."
- **Isolation.** Run parallel/background agents with `isolation: "worktree"`. Never run a build agent on a branch you're also committing to from the main checkout.
- **Only touch your own PRs.** Other agents may own open PRs/branches — never merge or push to a PR you didn't create unless the user says so.

## 1. First, sweep open PRs

```
gh pr list --state open --json number,title,headRefName,author
```

For each open PR **you created**:
- **Green + cold-reviewed → merge** it (`--merge`, never squash; `--delete-branch`). Preserve history.
- **Un-reviewed → spawn a cold review** (see §4) before merging. Never merge un-reviewed.
- **Red → never merge.** Read the failing check, fix the cause, push, re-monitor.
- **Flaky CI (known-flaky mobile job) → re-run** rather than treating as a real fail.
- **Superseded → close** with a note.
- **Design/product-sensitive (a pitch surface, a visual redesign, a copy-heavy surface) → HOLD** for the user's reaction even when green+reviewed. Leave it ready, note it, move on. (See §6.)

## 2. Pick the next item (ideate)

Work the standing roadmap **in order** if one was given; otherwise ideate genuine world-class improvements across every surface and persona (teacher / school-student / personal-learner / admin). Prefer:
- Real correctness/safety/data-loss/a11y/perf bugs → safe to build **and merge** autonomously.
- Missing coverage on a feature that has a harness probe or flow.
- Surfaces that are "functional but not amazing" — but if the fix is **design-sensitive**, queue it for the user (§6) rather than autonomously redesigning.

If a genuine product/design fork needs the user, **leave it noted and do other (non-blocked) work.**

## 3. Build

- Branch first (`git checkout -b ...` or a worktree); **never push to main.**
- Small, cohesive, conventional commits (`feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`).
- Pre-launch: change code directly — no back-compat shims, migrations for "old" rows, or feature flags with no audience.
- Cover a significant new feature with durable, conservative-assert coverage (harness probe for AI output; a flow for a multi-step journey). Trivial/cosmetic → browser render check only.

## 4. Cold-review (mandatory before merge)

Spawn a **fresh independent review agent with no conversation context** (`general-purpose`, background, `git diff main...<branch>`). Two passes; label findings **confirmed** (traced) vs **suspected**; tier P0–P3. For higher-stakes PRs run both the in-session `/review` *and* the cold agent — they're complementary. **Fix every confirmed finding before merging.**

## 5. Test (real evidence)

- `tsc` + lint to **0** for any touched package; ruff + mypy for `api`.
- Harness-test any probed AI surface: `python -m tests.harness for-diff --mode replay` ($0); a deterministic FAIL is a real bug.
- **Every UI change needs a real captured screenshot** committed under `docs/design/` and embedded in the PR — at presentation/real scale, **viewed** (a subagent saying "looks like X" is not a screenshot). Verify the **blast radius**: screenshot each affected adjacent surface, not just the new one. If the stack isn't up, restart the dev server when the machine is calm (kill any runaway `next` process pegging CPU; a slow dev server is usually a stale `node_modules` — `pnpm/npm install` first). If a surface genuinely can't be captured, say so explicitly with what you verified instead.
- Every PR body carries a **Test Plan with evidence** (each check + pass/fail, manual-verification note, screenshots).

## 6. Merge — or hold

- **Merge** when: cold-reviewed clean + CI green + tested + you're confident, AND it isn't design/product-sensitive. `--merge` (preserve history), `--delete-branch`.
- **Hold for the user** when the surface is design/product-sensitive (a customer pitch, a brand-defining redesign, copy a stakeholder will scrutinize). Push it, get it green, summarize, and let the user react first. Don't auto-merge their taste call.
- After merge, monitor that main stays green; then go to **§2 (next)**.

## 7. When the work is done

- If everything in scope is built and merged (and any held items are clearly noted as awaiting the user), give the user an **`/explain-simple`** summary of everything done + what's awaiting them.
- If a fork needs the user and nothing else remains, **note it and stay idle** — don't invent busywork or autonomously merge design-sensitive changes.

## Pacing (when self-scheduling)

If running on a timer, schedule the next tick to match what you're waiting on (CI ~ a few minutes; a long background build longer). Don't poll for harness-tracked work that re-invokes you automatically. Flag long multi-minute background builds to the user; don't silently re-dispatch the same task (looks like thrashing).
