# Autonomous improver

Drives the **real running app**, finds concrete improvements across UI, AI-output
quality, and small features, and — on your approval — implements + reviews +
opens a PR autonomously. Built on the test harness (same cached Chromium, token
injection, isolated seed, cassette $0 replay, cost tracker).

## The loop

```
[scheduled: cloud routine, ~once per limit-reset window]
  improve scan ──> screenshots + detectors + UX judge + corpus + feature pass
              ──> ranked, deduped proposals ──> durable queue (improver/state branch)
  agent reads top proposals ──> PushNotification + thread digest ──> exits
                                          │
[you, on phone] reply "do dd6a95"  ───────┘
                                          ▼
  agent: improve approve <id> ──> improve execute <id> (prints brief, budget-gated)
       ──> spawns ONE worktree-isolated subagent per approved proposal:
           /plan ──> implement (size-capped) ──> for-diff ──> cold /review ──> open PR
       ──> improve done <id>            (stops at PR-open; you merge)
```

**Why split Python vs. agent?** Python does the deterministic heavy lifting
(scan, judge, propose, queue, budget, brief assembly). The Claude session does
what only an agent can: `PushNotification`, `RemoteTrigger` (the cron), and
spawning coding subagents (`/autopilot` et al.). The brief that bridges them is
versioned in `execute.py`, not a doc.

## Commands

```bash
# Scan → ranked proposals → HTML report + queue (auto records cassettes; replay is $0)
python -m tests.harness improve scan --mode auto

# Inspect / manage the durable queue
python -m tests.harness improve proposals          # list open
python -m tests.harness improve show <id>          # one proposal, full
python -m tests.harness improve approve <id>       # what your "do <id>" reply maps to
python -m tests.harness improve reject <id>        # never re-surfaced
python -m tests.harness improve execute <id>       # print the subagent brief (budget-gated)
python -m tests.harness improve done <id>          # mark shipped after PR opens

# Budget status
python -m tests.harness improve budget
```

Useful scan flags: `--apps web,admin,mobile_web`, `--max-surfaces N`,
`--max-size S|M|L`, `--no-judge`, `--no-content`, `--no-features`,
`--ignore-budget`.

## Configuration (env)

| Var | Purpose | Default |
|---|---|---|
| `IMPROVER_ANTHROPIC_API_KEY` | Dedicated Console key — bills scan/judge/ideation here, never your subscription | (uses default key) |
| `IMPROVER_STATE_DIR` | Where ledger + queue live (the `improver/state` branch in the cloud loop) | `tests/harness/improver/_state` |
| `IMPROVER_MAX_SCANS_5H` | Hard scan cap per rolling 5h | 2 |
| `IMPROVER_MAX_EXEC_7D` | Hard execution (PR) cap per rolling 7d | 8 |
| `IMPROVER_MAX_USD_7D` | Hard $ ceiling per rolling 7d | 15 |
| `IMPROVER_LOCAL_TOKEN_CEILING_5H` | Optional: skip scan if your own local Claude usage in 5h exceeds this | 0 (off) |
| `HARNESS_WEB_BASE` / `_ADMIN_BASE` / `_MOBILE_BASE` | App base URLs to scan | :3000 / unset / unset |

## Cloud-routine runbook (paste as the RemoteTrigger prompt)

> Every run: `cd` to the repo, `python -m tests.harness improve scan --mode auto`.
> If it prints `SKIPPED — …`, stop (budget gate did its job). Otherwise run
> `python -m tests.harness improve proposals`, then send a `PushNotification`
> with the top 3 titles + their ids and post the same as a thread message. Stop.
> Do **not** code. When Ben replies approving ids, for EACH: run
> `improve approve <id>` then `improve execute <id>`, spawn a subagent
> (`isolation: worktree`) with the printed brief as its prompt, and after it
> reports a PR run `improve done <id>`. Then immediately spawn a fresh
> cold-context review agent on that PR (per CLAUDE.md).

Cadence: tie to the limit-reset window (~one scan per 5h), off the :00/:30
marks. The budget ledger is the hard backstop regardless of cadence.

## Mobile

`--apps mobile_web` scans the **Expo web build** (`npm run web`, :8081) — real
react-native-web rendering, good for visual/UX + most bugs. True **native**
iOS/Android (gestures, native nav, SecureStore) needs a simulator + Maestro;
that's a later tier that runs on your Mac or a macOS CI runner, not the Linux
cloud routine. admin + mobile_web also need their own token injection (and admin
an admin-user seed) before they scan authenticated — tracked in `surfaces.py`.

## Known limitations

- **Replay determinism (UI proposer):** detector hits read the live DOM (axe,
  overflow, timing), which can vary run-to-run, so the UI proposal cassette key
  shifts and `--mode replay` may miss it. The corpus + feature sources replay
  cleanly (stable input hash). The scheduled loop uses `auto`, so this only
  affects $0 regression replays of the UI proposer.
- **Surfaces:** default scan is `web` (public + student/teacher). admin +
  mobile_web are catalogued but excluded until their auth plumbing lands.
- **Features source** reasons from the route catalog only; intentionally damped
  and labelled lower-confidence.

## Go-live checklist

1. Create a Console (pay-as-you-go) key → set `IMPROVER_ANTHROPIC_API_KEY`.
2. `git branch improver/state` to hold the queue + ledger across cloud runs.
3. Create the `RemoteTrigger` routine with the runbook prompt above.
4. Tune caps via the `IMPROVER_*` env vars; watch `/usage` + `improve budget`
   for the first few runs and adjust.
