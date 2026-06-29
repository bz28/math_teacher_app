# Fixes from the golden-set run

## 1. Geometry figures silently dropped (confirmed bug → fixed)

**Symptom.** During generation, the backend logged (twice, for 2 of 5 geometry questions):

```
figure_spec rejected by renderer (dropping figure): invalid figure spec: ... circle
  Value error, chord_labels key 'TA' doesn't match any entry in chords
figure_spec rejected by renderer (dropping figure): invalid figure spec: ... circle
  Value error, point_labels references unknown point: P
```

The question text still saved, but the diagram was thrown away — so accelerated-geometry
problems involving a tangent point or an external point arrived with no figure.

**Root cause.** `CircleFigure` (`api/core/geometry/dsl.py`) stores labels in two maps keyed off
the structural arrays: `chord_labels` (keyed like `chords`) and `point_labels` (keyed like
`points`). The LLM sometimes keys a label off geometry it never declared structurally — a
tangent segment `"TA"`, or an external point `"P"` that can't even be expressed in the
circumference-only `points` map. The model-validator treated that as fatal and raised, which
`render_figure_or_none` catches and turns into a dropped figure
(`api/core/geometry/renderer.py`). The JSON schema (`api/core/llm_schemas.py`) can't express the
"every label key must already exist in the array" cross-field constraint, and the prose didn't
restate it — so the model can't reliably satisfy it.

The aggravating part: **the strict check bought nothing.** The renderer drives entirely off
`chords`/`points` and already ignores unmatched label keys
(`spec.chord_labels.get(chord)`, `spec.point_labels.get(name, name)`), so a stray label would
simply go unused. The only thing turning "harmless unused label" into "whole diagram dropped"
was the fatal `raise`.

**Fix (`api/core/geometry/dsl.py`).** The validator now *drops* unmatched `chord_labels` /
`point_labels` keys instead of raising. The figure renders with every valid label intact; the
stray key is discarded (exactly what the renderer did with it anyway). Visual output for valid
specs is unchanged.

**Test.** `tests/test_geometry_renderer.py::test_render_circle_tolerates_unmatched_label_keys`
feeds a circle spec with a stray `chord_labels` key `"TA"` and a stray `point_labels` key `"P"`
and asserts the figure renders (valid labels kept, stray keys discarded). Full suite:
`56 passed`.

**Follow-up (not done here).** A durable contract fix is to inline labels onto the structural
entries (`chords: [{endpoints, label}]`, points with an optional `label`) so there's no separate
key to mismatch — tracked as a larger schema change, out of scope for this run.

## 2. AI Workshop could ship a wrong answer on a rewrite (confirmed P1 bug → fixed)

**Symptom.** Asked to "clean up" the tangent–secant problem, the AI Workshop returned a confident
rewrite whose published answer **did not solve the problem it wrote**: it reported arc TB = **166°**
for a problem whose correct answer is **178°** (it silently swapped x=21.5 → x=20 and "verified"
against the old 44° instead of the new 47°). One **Accept** click from publishing to students.

**Root cause.** `chat_with_bank_item` (`api/core/question_bank_chat.py`) had the chat LLM emit the new
`question` + `solution_steps` + `final_answer` in a single pass and surfaced it as accept-ready with
**no independent check** — the chat graded its own rewrite. First-pass generation, by contrast,
*separates* the steps: it generates the question, then independently solves it with
`generate_solutions` → `decompose_problem` (`api/core/step_decomposition.py`). The Workshop skipped
that solve. So this was an architecture gap, not a prompt issue — a prompt tweak would only lower the
rate, never guarantee correctness.

**Fix (`api/core/question_bank_chat.py`).** When a proposal changes the **question**, the Workshop now
discards the chat's inline solution and re-solves the new question with the **same `generate_solutions`
path generation uses**, taking the solution steps + final answer from the solver. The chat owns the
question text (and figure); the solver owns the answer. The chat's prose reply is replaced with a
neutral note so it can't state a contradictory number next to the verified preview. Solution-only edits
(question unchanged) are deliberately left alone, so a teacher's "make step 3 concise" isn't
overwritten. No CAS was added (that approach was previously declined for grading) — this reuses
infrastructure the pipeline already runs and trusts.

**Verification.**
- *Live, before→after:* the identical "clean it up" request that produced the fudged **166°** now
  returns the solver's correct **178°** in the proposal.
- *Tests:* `tests/test_question_bank_chat.py::TestQuestionRewriteReSolve` — (a) a question rewrite takes
  the solver's answer, not the chat's fudge; (b) a solution-only edit does not trigger a re-solve.
  Adjacent suites green (`87 passed`), `ruff` clean.

## 3. Quality items (logged, not code bugs)

- **Geometry Q2** (tangent–secant) generated correct but ugly math (arc = 386/3°). The AI-Workshop
  attempt to clean it up is what exposed bug #2 above; the original correct version is what ships.
- **Geometry Q5** figure draws interior chords instead of secants from an external point. Logged
  in `qa-report.md` as a figure-fidelity quality issue (the spec validated, so no bug fired).
