# Claude Rules

## Workflow

- Feature branches → PR → CI → merge to main. Never push directly to main.
- No squash merges. Use `--merge` to preserve commit history.
- Don't open PRs automatically. Push to branch, summarize changes, let the user decide when to open the PR.
- Don't push empty commits to trigger CI. CI runs automatically on PRs.
- After opening a PR, monitor CI until all checks pass. If any check fails, update the user with: which check failed, why it failed, and what you're doing to fix it. Then fix the issue and push the fix. Repeat until all checks are green before telling the user the PR is ready.
- Small, cohesive commits (~150 lines). Each commit should be logically related.
- Conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Development Process

- Plan before coding. For non-trivial features, write a detailed plan in plain English first. Get explicit approval before writing code. Plans go in `plans/`.
- Feature-by-feature workflow. Work incrementally — after each logical chunk, summarize what/how/why and wait for the user to test before continuing.
- Verify and test changes. Trace through code, check edge cases (count=0, boundaries), read surrounding code before presenting work.
- Shipping checklist. Before saying work is done, summarize: what was done, how, why, and how it was tested.
