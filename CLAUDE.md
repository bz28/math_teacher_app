# Claude Rules

## Product context

- Veradic is an AI math-education **school portal**: students photograph handwritten homework; the platform grades it, runs a conversational understanding-check, and hands teachers a class-at-a-glance with the students who need help surfaced first. Full product + customer + feature context: [`docs/product/overview.md`](docs/product/overview.md) — **read it when reasoning about features or proposing changes** (it's the single source of truth; don't duplicate it here).
- **Build for teachers, sell to districts.** The teacher is the hero/daily user (the product must win their love first); the district is the buyer/expansion path; the student app is the input surface.
- Load-bearing principles: the teacher sees and approves **every** AI grade (nothing auto-posts); integrity **raises scrutiny, never auto-flags**; generated content is **verified before it's trusted**; tutoring **guides, never gives answers**. Subjects: **math is mature; physics/chemistry are partial.** Scope is the homework→grade→understand→reteach loop today (not a general LMS) — a current focus, not a permanent boundary.

## Ground truth

- Ground every claim in the actual code. Before stating how something works, read the file and cite `file:line`. When memory or an earlier turn conflicts with what you observe now, trust what you observe and update/drop the stale recollection.
- Pre-launch: no real users yet. Skip legacy-compat engineering — no backwards-compatibility shims, no migration backfills for "old" rows, no deprecation wrappers, no feature flags gating changes. Change the code directly.

## Workflow

- Feature branches → PR → CI → merge to main. Never push directly to main.
- Use graphite for stacked work: `gt c -m "msg"` to commit, `gt s` to submit the stack. Each PR in a stack should be independently reviewable.
- No squash merges. Use `--merge` to preserve commit history.
- Don't auto-commit and don't auto-open PRs — unless the user invoked `/autopilot`, which authorizes commit + push + PR-open autonomy for the scoped task. Outside autopilot: before committing, summarize what/why and ask; before opening a PR, push the branch, summarize, let the user decide.
- Don't push empty commits to trigger CI. CI runs automatically on PRs.
- After opening a PR, monitor CI until all checks pass. If any check fails, update the user with: which check failed, why it failed, and what you're doing to fix it. Then fix the issue and push the fix. Repeat until all checks are green before telling the user the PR is ready.
- **Every PR description includes a Test Plan with evidence — this is mandatory, not optional.** Document exactly how the change was verified: each automated check run (tsc/lint, CI, unit/pytest, harness) with its pass/fail result, plus a one-line note on manual verification. For any **user-facing / UI change, attach a screenshot of the changed surface in the PR** (before→after when you're altering something that already existed) — a UI PR without a screenshot is not ready to call done. If a surface genuinely can't be visually verified in this environment (e.g. mobile with no simulator, or a sub-second transient), **say so explicitly** in the test plan with what you verified instead (types/tests/cold-review) — never silently omit it. The same evidence belongs in the message you give the user when reporting the PR.
  - **Hard gate — a UI PR is NOT done, and must not be reported as ready, until one of these is true: (1) a real captured screenshot of the changed surface is committed to `docs/design/` and embedded in the PR body, OR (2) the Test Plan names the specific reason a screenshot couldn't be captured (e.g. local stack not up, no seeded data) AND exactly what was verified instead — and you flag that missing-screenshot gap to the user in the same message, not silently.** Describing the UI in prose, or a subagent reporting "it looks like X," is NOT a screenshot and never satisfies this gate. When a screenshot is possible, stand up the local stack and capture it — don't default to the prose escape hatch.
  - **Mechanism — the picture must live in git with the PR, not only in chat.** Commit the screenshot(s) under `docs/design/` on the PR branch and embed them in the PR body with `![label](https://github.com/<owner>/<repo>/blob/<branch>/docs/design/<file>?raw=true)` (before→after for a redesign). Sending the image to the user via chat is a courtesy on top, not a substitute — the PR summary itself has to show the picture.
- **Verify the blast radius, not just the new thing.** A change to a shared component, store, hook, API contract, or migration can silently break surfaces it didn't obviously touch. Identify what the change could affect (every call site of an edited component/function, every screen that reads a changed store/endpoint) and confirm those *still function the same* — exercise the adjacent flow, not just the new feature. **Attach a screenshot of each affected surface you checked**, not only the changed one. If you can't verify an affected surface, list it as an explicit risk in the Test Plan rather than assuming it's fine.
- Small, cohesive commits (~150 lines when the change is cohesive; larger is fine for a single logical operation like a rename or bulk delete).
- Conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Development Process

- Plan before coding. For non-trivial features, use `/plan` to draft the approach in plain English first, iterate with the user, and get explicit approval before writing code. Keep the plan in the conversation — do NOT persist it to a file in the repo. Stale plan docs drift away from the code; trust the code as the source of truth.
- Feature-by-feature workflow. Work incrementally — after each logical chunk, summarize what/how/why and wait for the user to test before continuing.
- Verify and test changes. Trace through code, check edge cases (count=0, boundaries), read surrounding code before presenting work.
- Harness-test AI-generated surfaces. When a change touches a feature with a test-harness probe (`tests/harness/probes/` — geometry today), run `python -m tests.harness for-diff` as part of `/review` and `/autopilot` and fold the result in. It drives the real app to confirm generated figures/solutions render correctly; `replay` mode is $0. A deterministic FAIL is a real bug, not a flake. Deeper generation-quality sweeps: `python -m tests.harness explore` (autonomous; promotes new failures to a $0 regression corpus).
- **A prompt edit is the last resort, not the first.** When an AI-generated surface misbehaves (wrong figure, bad solution, misgrade, flaky output), don't reach for the LLM prompt first. Trace it to a root cause: deterministic bugs — wrong data passed into the call, an off-by-one, a parsing/serialization error, a missing guard, a stale cache, a render bug downstream — are common and fixable *for good*, whereas a prompt tweak is probabilistic, can regress other cases, and often just masks the real defect. Walk the whole path (inputs → the call → post-processing → render) and rule out a deterministic cause before touching the prompt. If you do change the prompt, state what deterministic causes you ruled out and why the prompt is genuinely at fault.
- Cover new features with a durable test. When you build a significant new feature, leave behind reusable coverage and run it before declaring done — don't rely on a throwaway one-off check. Pick the lightest coverage that actually guards the feature: AI-generated output (figures, solutions, grading) → a **harness probe** (the geometry pattern in `tests/harness/probes/`) with deterministic checks; a user-facing multi-step journey (login, submit, checkout) → a **flow** (the login/logout pattern in `tests/harness/improver/flows.py`), conservative-assert so it can't flake. A trivial/cosmetic change just needs the browser render check — no new test. This is how probe/flow coverage grows past geometry instead of staying stuck there.
- Run `/review` on every PR before declaring it ready to merge. For larger or higher-stakes PRs, also spawn a fresh independent review agent without conversation context — a self-review done inside the same session is biased toward the work you just did. The two are complementary, not redundant: `/review` runs in-session (intent-aware, but biased toward the just-written code), while the cold agent has no conversation context (independent, but intent-blind). On any autopilot or higher-stakes PR, run **both** before merge — don't substitute the cold agent for the `/review` pass.
- After every `/autopilot` run that pushes to a PR (open or update), immediately spawn a fresh independent review agent in the background — do not pause to ask. Same protocol as above: cold context, two-pass, confirmed/suspected labels. Skip only for non-PR-pushing autopilot runs or when the user explicitly opts out.
- When reviewing, do two passes. First pass: jot every concern. Second pass: re-verify each by reading actual code; discard anything you can't confirm. Label survivors as **confirmed** (traced, real) or **suspected** (plausible, couldn't fully verify). Don't propose fixes until the user approves.
- Shipping checklist. Before saying work is done, summarize: what was done, how, why, and how it was tested — and for any UI work, include the screenshot evidence (the same shot that's attached to the PR per the Workflow Test Plan rule).

## Code quality

- DRY: don't extract abstractions beyond what the task requires. Three similar lines is better than a premature abstraction. Inverse — extract a helper when at least 2 of these are true: (1) duplicated 3+ times, (2) the logic is complex enough that a name conveys real insight, (3) the call sites are likely to evolve together, (4) the duplication is where bugs cluster historically. If the only argument is "it's repeated," leave it inline.

## Frontend design

- For new UI surfaces (pages, modals, dialogs, significant components), invoke `/frontend-design:frontend-design` before writing styles. Skip for small tweaks (single property edits, copy changes, layout nudges). The goal: every new surface gets a deliberate aesthetic pass before it lands, instead of relying on defaults.

## Skills

- `/plan` — draft an approach in conversation before starting a non-trivial feature
- `/review` — two-pass code review with confirmed/suspected labels; no fixes until approved
- `/autopilot` — autonomous multi-commit execution on a well-scoped task
- `/explain-simple` — one-paragraph plain-English summary for a non-technical audience (what changed and why), typically invoked right after a feature ships
- `/frontend-design:frontend-design` — deliberate aesthetic pass on new UI surfaces (see Frontend design)
