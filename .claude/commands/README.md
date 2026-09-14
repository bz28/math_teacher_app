# Slash Commands

| Command | When to use |
|---------|-------------|
| `/plan` | Before coding — design the approach, get approval first |
| `/implement` | Build a feature commit by commit, pausing for you to test |
| `/autopilot` | Same as implement but runs start to finish without stopping |
| `/audit` | Deep clean the whole codebase — finds and fixes quality issues |
| `/review` | Loop cold review + skeptic verification on your branch, fixing every confirmed finding, until a round comes back clean |
| `/debug` | Something is broken — investigate root cause and propose a fix |
| `/ui` | Design or fix frontend/UX |
| `/explain-simple` | Explain what just happened in plain english |

**Canonical per-feature loop:** `/plan` → `/explain-simple` → (you approve) → `/implement` or `/autopilot` → `/review` → `/explain-simple` → (you test) → next feature. Skills are built to hand off in this order.
