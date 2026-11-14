# Figure text auditor: eval result (2026-11-14) — not adopted

**Question.** Could one extra AI call (an "auditor") replace the coverage
allowlist in `api/core/geometry/coverage.py`? The auditor reads the problem
and the agreed facts (written by code) and lists every statement the facts
don't capture, each with an exact quote and a counterexample (a figure that
meets every listed fact but breaks the statement).

**Code.** `api/core/geometry/audit.py` (prompt, schema, how the facts are
written out, quote check). Eval: `tests/harness/probes/figure_auditor.py`,
labelled set `tests/harness/_corpus/figure_auditor.json`, recorded calls in
`tests/harness/_cassettes/figure_auditor/` (replay is $0:
`HARNESS_LLM_MODE=replay python -m tests.harness.probes.figure_auditor`).
The auditor is not wired into `trusted_reading`.

**Labelled set (193 cases).**
- 99 missed-fact cases (104 left-out statements): 57 real agreed readings
  with one fact removed (each checked by hand), 9 real readings refused by
  coverage today that do miss something, 33 hand-written wordings
  (inequalities, complements, "respectively", "each", the subject of
  "intersects", shapes and positions, hints that state a fact, stories).
- 94 clean cases: 25 prod and 40 adversarial readings trusted today, 24 real
  readings refused by coverage today but judged complete, 5 hand-written
  clean versions of the story cases.

**Results** (Sonnet, temperature 0, two runs):

| | Run 1 | Run 2 |
|---|---|---|
| Recall (a quote covers the left-out statement) | 98/104 (94%) | 100/104 (96%) |
| Missed-fact cases refused at all | 97/99 | 96/99 |
| False alarms on clean cases | 42/94 (45%) | 45/94 (48%) |

Same refuse-or-not verdict in both runs: 187/193; same quotes: 160/193.
Cost: $2.34 in all, about $0.0056 per call. The prompt was adjusted once on
10 of these cases.

Misses include a dropped statement to prove (△ABC ≅ △DEF) and a
wrong-subject "intersects PR at S", either of which could let a wrong figure
pass. False alarms mostly treat questions as unchecked facts, invent layouts
the names or listed facts already rule out, or flag method names.

**Conclusion (coordinator, 2026-11-14): stop.** With 94–96% recall it can't
replace the exact code checks (its misses are possible wrong figures), and
with a 45% false-alarm rate it adds no draws as an extra layer. A second
prompt pass would not fix the recall problem.
