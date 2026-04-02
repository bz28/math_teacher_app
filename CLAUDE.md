# Claude Rules

## Available Commands

| Command | When to use |
|---------|-------------|
| `/plan` | Before coding — design the approach, get approval first |
| `/implement` | Build a feature commit by commit, pausing for you to test |
| `/autopilot` | Same as implement but runs start to finish without stopping |
| `/audit` | Deep clean the whole codebase — finds and fixes quality issues |
| `/review` | Check your current branch for bugs, security, and DRY violations |
| `/debug` | Something is broken — investigate root cause and propose a fix |
| `/ui` | Design or fix frontend/UX |
| `/explain-simple` | Explain what just happened in plain english |

## Workflow

- Feature branches → PR → CI → merge to main. Never push directly to main.
- No squash merges. Use `--merge` to preserve commit history.
- Don't open PRs automatically. Push to branch, summarize changes, let the user decide when to open the PR.
- Don't push empty commits to trigger CI. CI runs automatically on PRs.
- Small, cohesive commits (~150 lines). Each commit should be logically related.
- Conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Development Process

- Plan before coding. For non-trivial features, write a detailed plan in plain English first. Get explicit approval before writing code. Plans go in `plans/`.
- Feature-by-feature workflow. Work incrementally — after each logical chunk, summarize what/how/why and wait for the user to test before continuing.
- Verify and test changes. Trace through code, check edge cases (count=0, boundaries), read surrounding code before presenting work.
- Shipping checklist. Before saying work is done, summarize: what was done, how, why, and how it was tested.
