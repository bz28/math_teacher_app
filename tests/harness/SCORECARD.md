# AI-feature scorecard

One command runs every AI-feature eval that can replay at **$0 with no app
server**, and prints one table:

```bash
python -m tests.harness scorecard
```

- **never**: a count of things that must never happen (a wrong figure passed,
  full credit for broken work, "yes" for an undrawn graph feature...). Above 0 → FAIL.
- **how good**: a share from 0 to 1 (figures drawn, cases graded as labelled...).
  Below the committed baseline (`scorecard_baseline.json`) → FAIL.
- Also FAIL: a probe that crashes or misses a cassette; a case count below the
  baseline; a how-good number that the baseline has but this run can't compute;
  a cassette miss swallowed by the app that isn't already listed (by call and
  key) in the baseline; a baseline row that produced nothing; a missing
  baseline file (unless `--write-baseline`).
- A probe that can't run here prints `skipped: needs <x>`. It is never dropped.

It is replay only. The command sets `HARNESS_LLM_MODE=replay` and a fake API
key, so a call with no recording raises an error and can't cost anything. It
needs no database: the app's DB URL points at a port nothing listens on.
Flags: `--only <probe>…`, `--json PATH`, `--write-baseline` (after a
deliberate improvement or re-record).

**Integrity is not on the scorecard** (Ben, 2026-11-14). Its probe stays in the
repo and runs as before with `python -m tests.harness run --probe integrity`.

**What replay can and can't see.** Replay hands back the model output that
was *recorded*. So these numbers move only when our own code around the model
changes: a checker, a parser, the code that combines results, or a prompt edit
that changes the cassette key and so misses. A change in the model's
*judgment* needs a paid re-record, and this command never makes one.

CI: `tests/harness/test_scorecard.py` runs the command in its own process
(about 17 s) with no database. It also checks
that the scorecard fails when the figure checker is switched off (a revert
check).

## Today's scorecard (2026-11-14, macOS, replay)

```
AI-feature scorecard (replay, $0)

  probe                          never  how good  cases  result
problem generation
  generation                         -         -      -  skipped: needs a running API server + Postgres; live-only by design (no cassettes kept)
  latex                              -         -      -  skipped: needs a running API server + Postgres; live-only by design (no cassettes kept)
  generation-figures (sets)          0         -     20  PASS
                                   - no $0 correctness measure: the correctness judge (generation probe) is live-only
homework diagrams
  generation-figures                 0     0.600     20  PASS
                                   - 8 figures drawn; missing: set1-p3, set1-p6, set1-p8, set2-p8
  geometry                           -         -      -  skipped: needs a running API + web server, Postgres and a browser
chat diagrams
  construction-figures               0     0.364     69  PASS
                                   - readings agreed 26/69
                                   - 2 cassette miss(es) swallowed by the app: call_claude_json 54d7fb6b1a406d9377a746359297c268 (decompose), call_claude_json fcc0b3f7f8f6d52dd6608e763fb0af88 (bank_chat)
  construction-adversarial           0     1.000    106  PASS
step diagrams
  generation-figures (steps)         0     0.000     23  PASS
                                   - 0 step figures shown, so the consistency bar cannot fail yet (gap)
  construction-figures (steps)       0         -      -  PASS
                                   - 0 step figures drawn on this corpus, so this bar cannot fail yet (gap)
reading student work
  extraction-fidelity                -         -      -  skipped: needs its vision cassettes, which were never committed (recording is paid)
  drawing-eval                       0     1.000      3  PASS
  drawing-flag                       0     0.968     62  PASS
grading
  grading                            0     1.000     38  PASS
                                   - score label right 38/38
  graph-check                        0     1.000      8  PASS

10 rows ran, 4 skipped, 0 failed: PASS
```

## Audit: every probe in `tests/harness/probes/`

| Probe | Feature row | What it measures | Gold (the right answers) | Never (must be 0) | How good | $0 offline? | Replay today |
|---|---|---|---|---|---|---|---|
| `generation` | problem generation | Real generation from plain teacher topics (6 topics × 2): is a figure there when it should be, is the maths correct | No gold. A cheap Haiku judge re-solves each problem, and a rule says geometry gets a figure and algebra doesn't | A figure on an algebra topic, or none on a geometry one | Share the judge calls correct | **No**: needs the API server + Postgres; live by design | skipped |
| `latex` | problem generation | Generation on 12 LaTeX-heavy topics; looks for the control-character corruption | A fixed code check for the corruption | LaTeX corrupted into control characters | none | **No**: same as `generation` | skipped |
| `generation_figures` | problem generation, homework diagrams, step diagrams | 3 generated homework sets (20 problems): does each problem get the figure it needs, and are the figures right? Step figures from the solver | `EXPECTED` (Ben's figure/none rule, set by hand), `BY_EYE` (each figure looked at, tied to its fingerprint), `NEGATIVES` (hand-made wrong figures) | Wrong figure; figure on a no-figure problem; "the figure" with none; a drafted figure shipped unchecked; a wrong figure the checker passed; a figure nobody looked at. Steps: a shown step figure judged wrong or unwanted by eye, one that disagrees with the problem's figure, a known-wrong step figure passed, one nobody looked at | Problems that need a figure and got one (0.600). Steps: share of the step figures the solver drew that are shown (0.000) | Yes | PASS |
| `geometry` | homework diagrams | Generated geometry figures shown in the teacher review UI, then screenshots | Code check that each figure re-renders and is well-formed; a Haiku vision judge gives advice | A figure that doesn't re-render | Judge mean (advice only) | **No**: needs API + web server, Postgres, a browser | skipped |
| `construction_figures` | chat diagrams, step diagrams | The workshop chat draws a figure when a teacher asks, on 69 real prod problems | `EXPECTED` + `BY_EYE` (by eye), `NEGATIVES` (hand-made wrong figures) | The probe's own bar checks: wrong figure passed, a reply claiming a figure it didn't draw, a wrong figure the checker passed, a figure nobody looked at, a decline case drawn, a crash. Steps: a step figure that moves a point | Problems that should get a figure that got a checked one (24/66 = 0.364) | Yes | PASS (2 cassette misses swallowed, see gaps) |
| `construction_adversarial` | chat diagrams | 106 reviewer-written tricky wordings, each with a correct figure and a wrong one | Hand-written correct/wrong figures; hand-listed expected declines | Wrong figure passed (or caught only as "not marked"); a crash; a can't-check wording that got drawn | Correct figures that pass, out of the checkable ones (1.000) | Yes | PASS |
| `extraction_fidelity` | reading student work | Small, blurry handwritten pages: does the transcript report what the student wrote, or the answer the question implies? | Generated pages, so the truth is exact | The transcript contains the answer the question implies | none | **No**: its vision cassettes were never committed (the shared vision file is gitignored); recording costs money | skipped |
| `drawing_eval` | reading student work | First read vs the zoomed second look on 3 hand-drawn graph/number-line pages; grading ablation | Generated pages, so the truth is exact | Drawing lost before the grader; a false "couldn't confirm"; wrong line count; an answer on the drawing lost | Pages with every check right (weak: 3 cases) | Yes, **on macOS only** (the pages use Bradley Hand) | PASS |
| `drawing_flag` | reading student work | Does a question require a drawing? AI call vs regex vs label, 62 phrasings | Hand labels | Stored flag (AI or regex) wrong; an AI-alone miss not on `AI_KNOWN_MISSES`; a listed known miss the AI now gets right (the list is stale) | AI call alone right (60/62 = 0.968; 2 misses listed as known) | Yes | PASS |
| `grading` | grading | 38 hand-labelled submissions: other method, right answer with broken work, slips, blank, required method, class rules, theorems | Hand labels (accepted score_status, percent bands, deduction words) | Full credit on work not labelled full; deduction ledger that doesn't add up; step ref out of range; rule id shown to the teacher | Cases with every check right (1.000) | Yes (shared committed `call_claude_json.json`) | PASS |
| `graph_check` | grading | The checklist check on a student's graph, 8 generated pages (wrong asymptote, one branch, written but not drawn, no graph...) | Generated pages + a hand verdict per checklist item | "yes" for a feature that isn't drawn; "no" for one that is; a verdict on a page with no graph | Verdicts that match the drawing exactly; "unclear" counts as a miss (1.000) | Yes, **on macOS only** (same font) | PASS |
| `integrity` | not on the scorecard (Ben, 2026-11-14) | The real integrity agent, 22 scripted students + 6 engagement cases | Hand-labelled disposition bands and harm tags | Honest-but-halting student flagged; memorised student passed; injection flipped to pass; over the turn budget | Cases with every check right (1.000) | Yes, with a scratch Postgres (no server) | not run (off the scorecard) |

Notes:
- Not every module in `probes/` is in the `PROBES` registry. `generation_figures`
  and `construction_adversarial` aren't, so `run` / `for-diff` never run them
  (CI runs them through `tests/test_*_figure_eval.py`). The scorecard runs both.
- Before this PR, CI replayed only the two figure evals. Grading and
  drawing-flag replay are new in CI here.

## Gaps found

1. **Step-figure bars can't fail.** No step figure is shown in either corpus
   (generation-figures: 0 of 23 shown; construction-figures: 0 drawn). So "step
   figure keeps the problem's points" and "step figure moves a point" can't be
   triggered by any case. Step diagrams have no working measure yet.
2. **Two cassette misses are swallowed in construction-figures.** Case
   `77195d48` (decompose) and `df891226` (redraw) miss their recordings in
   replay. The app catches the error, so replay takes a different path than
   the recording did. `77195d48` is the case behind
   `test_a_rewritten_problem_without_a_figure_gets_no_step_figures`, which may
   pass only because the solve call failed. The baseline lists exactly these
   two misses; any other miss fails. The fix is a paid re-record of those two cases.
3. **Problem generation has no $0 correctness measure.** The correctness judge
   (`generation`) and the LaTeX guard (`latex`) are live only. The only offline
   row is the set-level count and repeat check.
4. **Extraction fidelity (the "reads the answer it expects" failure) never runs
   offline**: its vision cassettes aren't committed.
5. **Two probes depend on the host.** `drawing_eval` and `graph_check` draw
   their pages with a macOS font, so on Linux CI they skip (shown as skipped).
   A committed font file would make them portable but would also change the
   pages, which means a paid re-record.
6. **Some how-good numbers are weak.** drawing-eval has 3 cases. Grading
   and graph-check sit at 1.000, so they can only stay or drop,
   and only when our own code changes (replay can't see the model's judgment;
   see above).
7. **geometry** (UI screenshots) needs the full stack. Nothing offline covers
   how a figure looks on the page.

## Not built yet: end-to-end journeys on real assignments (design stub)

The rows above test one stage at a time. The next layer runs **2–3 real prod
assignments end to end**, copied **read-only** into a test DB with student
identity removed:

| Journey | Source | Why |
|---|---|---|
| Geometry set | A real geometry assignment, e.g. the Unit 5 proofs already in `_corpus/construction_figures.json` | Figures, proofs, step figures |
| Graphing set | A real graphing assignment | Drawn answers go through `graph_check` |
| Algebra set (optional) | A real algebra assignment | The no-diagram path |

**Gold:** the teacher's final grades, on submissions the teacher reviewed (not
AI grades nobody looked at). Every diagram in the run is checked by eye
(`BY_EYE` style, tied to its fingerprint).

**Edits inside the run** (through the real teacher chat):
- add a diagram to 1–2 problems;
- change a number on one problem.

**What each handoff checks:**
1. *Assignment → teacher chat:* an added diagram passes the checker and the
   by-eye verdict, or the chat declines honestly and doesn't claim a figure.
   A changed number updates the problem text, its figure labels and its answer
   key together.
2. *Edit → grading:* after an edit, grading uses the **edited** problem and its
   **new** answer key. A submission graded against the old key fails.
3. *Student page → reader:* the transcript matches the ink (no answer the
   question implies); a drawn answer reaches the grader as present.
4. *Reader → grader:* graphing answers go through `graph_check` ("yes" never
   given for a feature that isn't drawn). The grade agrees with the teacher's
   final grade where the teacher reviewed it.
5. *Grader → teacher:* every grade waits for teacher approval; nothing posts
   automatically.

**Layer 1 stays.** The synthetic hard cases in `grading` (other valid method,
right answer with wrong work, blank) are kept, since prod may not contain them.

**Open question:** may anonymised real student work (page images,
transcripts) be stored in committed cassettes? The journeys need it to replay
at $0. Until that's decided they can't be recorded. Recording is also paid.
