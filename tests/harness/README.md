# Autonomous test harness

Drives the **real app** end-to-end to verify AI-generated content renders
correctly, with near-zero API cost. First probe: **geometry** figures.

## What it does
For a probe (a feature under test) it: seeds a teacher/course/assignment in a
separate DB → calls the **real** generation endpoint → checks the output
deterministically (renders, consistent, well-formed) → drives a real browser
to screenshot the rendered question **and** its worked solution → has a cheap
**Haiku judge** score the screenshots → writes an HTML report and a row in the
admin **Harness Runs** tab.

## Cost control (cassettes)
Every Claude call is recorded once and replayed for **$0** thereafter
(`HARNESS_LLM_MODE` via the hook in `api/core/llm_client.py`, off in prod).
- `replay` (default) — saved responses, $0, deterministic. A miss is a hard error.
- `record` — always re-records (refresh after a prompt change).
- `auto` — replay if present, else record.

## Commands
```bash
# Run a probe end-to-end → HTML report + admin row
python -m tests.harness run --probe geometry --mode replay

# Run only the probe(s) whose feature the current changeset touches
# (used by /review and /autopilot)
python -m tests.harness for-diff --base main --mode replay

# Autonomous explorer: an LLM invents diverse + adversarial scenarios from
# the probe's capability_spec; failures promote to a $0 regression corpus
python -m tests.harness explore --probe geometry --scenarios 8 --mode auto
python -m tests.harness explore --probe geometry --from-corpus --mode replay
```

## Prerequisites for a live run
- API on `:8000` pointed at the harness DB, web on `:3000`, Postgres up.
- `mathapp_harness` DB migrated (`alembic upgrade head`).
- The API process needs `HARNESS_LLM_MODE` set to use cassettes.
- Run summaries are written to the **main** DB (`--summary-db`) so the admin
  dashboard "Harness Runs" tab can show them.

## Adding a probe
Implement `tests/harness/probe.Probe` (name, `relevant_paths`, `capability_spec`,
`generate`, `deterministic_checks`, `capture_cards`, `judge_rubric`) and register
it in `tests/harness/probes/__init__.py`. Everything else (cassettes, browser,
judge, report, explorer, admin tracking) is shared.
