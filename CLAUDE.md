# Claude Rules

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
- Small, cohesive commits (~150 lines when the change is cohesive; larger is fine for a single logical operation like a rename or bulk delete).
- Conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Development Process

- Plan before coding. For non-trivial features, use `/plan` to draft the approach in plain English first, iterate with the user, and get explicit approval before writing code. Keep the plan in the conversation — do NOT persist it to a file in the repo. Stale plan docs drift away from the code; trust the code as the source of truth.
- Feature-by-feature workflow. Work incrementally — after each logical chunk, summarize what/how/why and wait for the user to test before continuing.
- Verify and test changes. Trace through code, check edge cases (count=0, boundaries), read surrounding code before presenting work.
- Run `/review` on every PR before declaring it ready to merge. For larger or higher-stakes PRs, also spawn a fresh independent review agent without conversation context — a self-review done inside the same session is biased toward the work you just did.
- After every `/autopilot` run that pushes to a PR (open or update), immediately spawn a fresh independent review agent in the background — do not pause to ask. Same protocol as above: cold context, two-pass, confirmed/suspected labels. Skip only for non-PR-pushing autopilot runs or when the user explicitly opts out.
- When reviewing, do two passes. First pass: jot every concern. Second pass: re-verify each by reading actual code; discard anything you can't confirm. Label survivors as **confirmed** (traced, real) or **suspected** (plausible, couldn't fully verify). Don't propose fixes until the user approves.
- Shipping checklist. Before saying work is done, summarize: what was done, how, why, and how it was tested.

## Skills

- `/plan` — draft an approach in conversation before starting a non-trivial feature
- `/review` — two-pass code review with confirmed/suspected labels; no fixes until approved
- `/autopilot` — autonomous multi-commit execution on a well-scoped task
- `/explain-simple` — one-paragraph plain-English summary for a non-technical audience (what changed and why), typically invoked right after a feature ships
