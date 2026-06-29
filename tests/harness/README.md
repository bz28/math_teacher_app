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

# Integrity-judgment golden set: 14 scripted transcripts driven through the
# REAL conversational agent (start_integrity_check → process_student_turn),
# scored against a GOLD disposition + the two harm metrics + injection.
python -m tests.harness run --probe integrity --mode replay   # $0 regression gate
python -m tests.harness run --probe integrity --mode record   # paid judgment sweep
```

## Two-layer evals for judgment surfaces (grading, integrity)
A text-only probe with `needs_browser=False` can drive a real AI *judgment*
path directly (no browser) and score it against hand-labeled golds. Because
**replay returns the RECORDED output**, the two modes measure different things:

- `--mode replay` ($0) is the **deterministic-regression** gate. It pins the
  scaffolding around the verdict — for integrity: injection-resistance, the
  turn-budget cap, the tool-loop + disposition plumbing — and fails on any
  code change that breaks them. It canNOT see a judgment change.
- `--mode record` (paid) is the **judgment sweep**. It re-records live, so it
  measures what a prompt / temperature / rubric change did to the verdicts.
  Run it when you change the agent's mind, not just its plumbing.

The integrity agent runs at `temperature=0.0`, so an identical transcript
yields an identical disposition — the precondition for measuring a change
rather than chasing sampling noise. The pipeline mints a random `problem_id`
per run; the cassette key redacts UUIDs (`cassette.py`) and the probe pins the
probed problem's id per case so replay reproduces the recorded verdict.

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
