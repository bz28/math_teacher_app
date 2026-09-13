You are a worldclass engineer with expertise in writing clean, optimal, DRY, minimal code.

`/review` is a **loop, not a pass**. It runs cold, adversarially-verified review rounds on the current branch and fixes every confirmed finding until a round comes back clean. The bar is *confirmed no bugs* — not "reviewed once."

Why a loop: fixes introduce bugs. PR #888 ran four rounds and rounds 2–4 each found defects the previous round's fixes had introduced. One pass would have shipped three of them.

## The round

Each round is one invocation of the `review-loop` workflow — a cold reviewer with **no conversation context** reads the diff and every touched file end-to-end, then **2 independent skeptics try to refute each finding** (strict: a finding survives only if both skeptics read the code and failed to knock it down; default-refute when uncertain). Invoke it by **scriptPath** (named lookup does not find `.claude/workflows/`):

```
git fetch origin   # findings against a stale main flag "rogue changes" that are already merged
Workflow({ scriptPath: ".claude/workflows/review-loop.js", args: {
  base: "origin/main", head: "HEAD", round: N,
  intent: "<one paragraph: what this branch is trying to do>",
  priorConfirmed: <round N-1's confirmed list>,     // round >= 2
  sinceLastRound: "<sha round N-1 reviewed>",       // round >= 2
}})
```

It returns `{ confirmed, refuted, priorStatus, stats }`. **Show both lists** — refuted findings are visible so nothing is quietly buried. Round ≥ 2 also returns `priorStatus` (`fixed` / `shallow` / `unfixed` per prior finding) — a `shallow` or `unfixed` verdict is a confirmed finding for this round.

**In parallel with the workflow, do your own in-session two-pass review** of the same diff (read touched files end-to-end; check callers and peers not in the diff; the checklist below). You know the intent, which the cold agents don't — that's the complementary lens. Anything you find that the workflow didn't goes through the same skeptics before it can be called confirmed: call the workflow again with `verifyOnly: [<your findings, same shape>]` — it skips the reviewer and runs only the skeptic stage.

Check for: correctness and logic errors · edge cases and boundaries · security (OWASP top 10) · performance · mobile UX · consistency with existing patterns · DRY violations and unnecessary complexity.

**Avoid by name:** style nits when correctness issues are unaddressed · "consider extracting X" when X is used once · "what about edge case Y?" without checking whether Y can actually happen given upstream guarantees · re-stating what the code does without naming a defect · suggesting tests for code already covered.

## The loop

```
round N  →  zero confirmed (any tier P0–P2, plus P3 you'd fix anyway)?  →  done
         →  else: fix EVERY confirmed finding, pin each fix, round N+1
cap: 4 rounds — then stop and surface what is still churning
```

**Confirmed → fix it. No asking, any tier.** The whole point of the skeptic stage is that "confirmed" means *survived adversarial verification*, so a confirmed finding is a bug and bugs get fixed. Reliable fixes only — no bandages, no hardcoded shortcuts.

**"Not sure" is not a state to stop in.** If a finding is refuted but you think it's real, or confirmed but you think it's intended — that's a to-do for *you*: read more code, trace the caller, write the test, run it, until it's either confirmed or refuted. **Only when you genuinely cannot resolve it** — usually because it's a product-behavior question ("is this the *intended* grading behavior?") rather than a code question — bring it to the user in plain English (`/explain-simple` register) with the evidence of what you tried. Product calls are the user's, not a defect to fix.

**Pin every fix.** A logic fix ships with a test that **fails when the fix is reverted** — actually revert it, run the test, watch it go red, restore it, record the result (`revert <fix> → 1 failed, 23 passed`). A UI-only fix gets the browser render check instead. This is the #888 standard; a fix without a pin is not done.

**Round N+1 reviews the full branch diff**, not just the fixes — but the reviewer is handed `priorConfirmed` + `sinceLastRound` so it re-checks each prior fix for substance and reads the fix code hardest.

## Adjacent checks (fold into round 1)

**Harness check (when the changeset touches a probed feature).** If any changed file matches a probe's `relevant_paths()` (`tests/harness/probes/` — geometry today: `api/core/geometry/`, figure-generation/decomposition, `figure-display.tsx`), run `python -m tests.harness for-diff --base main --mode replay`. A deterministic FAIL is **P1**; a judge-flagged render (overflow/clipping/low score) is **P2**. Requires the local stack up; if it isn't, say the harness was skipped rather than omitting it. Deeper: `python -m tests.harness explore --mode auto` (costs cents).

**Browser render check (any frontend/page change).** If the changeset touches `web/src/app/`, `web/src/components/`, `dashboard/src/`, routes, layouts, or CSS: drive the browser against the local stack. Log in by injecting tokens into `localStorage` (POST `/v1/auth/login` → `veradic_access_token` + `veradic_refresh_token` on web :3000; `admin_access_token` + `admin_refresh_token` on the dashboard). Open each page the change plausibly affects and confirm it loads (no error boundary), **no console errors**, and the changed element renders. Crash/blank = **P1**; console errors or visible breakage = **P2**. Capture a screenshot and attach it to the PR's Test Plan (before→after when altering an existing surface). If the stack isn't up, say the render check was skipped.

## Output

When the loop ends, present:

1. **Per round:** confirmed (file:line, tier, one line), refuted (title + why the skeptics threw it out), `priorStatus` for round ≥ 2.
2. **The pin table:** one line per fix — `revert <what> → N failed, M passed`.
3. **Anything surfaced for the user** with the evidence of what you tried.
4. **What was NOT changed and why** (refuted findings you agree with; pre-existing issues on main that are out of scope — list them, don't drop them).

Write the same into the PR body as a **"Review rounds"** section — the PR must show the rounds, not just the final state. Per CLAUDE.md the PR also carries a Test Plan with evidence (each automated check + result, manual note, screenshots for UI).

Be direct and specific. Reference exact file paths and line numbers.
