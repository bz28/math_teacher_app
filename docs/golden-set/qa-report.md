# Golden Set — QA Report

**What this is.** An end-to-end run of the problem-creation + review pipeline, used as a
"golden set": a curated, hand-verified example a customer can see, and an internal quality
benchmark. One teacher, two accelerated courses, real teacher worksheets as source material,
5 problems generated per course (FRQ + MCQ mix), every problem independently re-derived.

- **App build:** branch `worktree-golden-set-e2e`, model `claude-sonnet-4-6` (generation).
- **Teacher:** Dr. Avery Stone · **Courses:** Accelerated Geometry (Circle Theorems),
  Calculus (Applications of the Derivative).
- **Source material:** real Kuta Software worksheets + an optimization handout, uploaded as
  image documents and used as vision grounding. See `materials/`.
- **Method:** every problem re-solved by hand; answer **and** solution steps checked.

## Headline result

**10 / 10 problems are mathematically correct** — every stated answer is right and every
solution's reasoning is valid. The defects found are **quality and figure-rendering** issues,
not math errors. That is the point of the review step, and the flow fixes them.

## Per-problem verdict (independent re-derivation)

### Accelerated Geometry — Circle Theorems

| # | Type | Re-derivation | Verdict |
|---|------|---------------|---------|
| Q1 | FRQ easy | arc AC=(6x+4), ∠ABC=(2x+15); 2x+15=½(6x+4) → x=13 → **41°** | ✅ correct; figure renders |
| Q2 | FRQ med | 44=½[(8x+6)−(2x+10)] → x=46/3 → TB=**386/3≈128.67°** | ⚠️ math valid but **answer is an ugly fraction**, over-specified & awkwardly worded; figure **dropped by a bug**. An AI-Workshop attempt to clean it up **produced a wrong answer** (finding 0) — reverted; the **correct** original is kept |
| Q3 | FRQ hard | (x+2)(3x)=x(x+9) → 2x²−3x=0 → x=3/2 → **PB=9/2**; check 63/4=63/4 | ✅ correct & geometrically valid; question-figure **dropped by a bug** |
| Q4 | MCQ easy | ∠ABC=½(134)=**67°**; distractors 134 (no halving), 46, 113 (180−67) | ✅ correct; plausible distractors; figure renders |
| Q5 | MCQ med | 4·9=3·x → **x=12** | ✅ math correct, but the **figure is misleading** — it draws two interior chords, not two secants from an external point P, so it doesn't match the problem |

### Calculus — Applications of the Derivative

| # | Type | Re-derivation | Verdict |
|---|------|---------------|---------|
| Q1 | FRQ easy | dA/dt=2πr·dr/dt=2π(12)(3.5)=**84π≈264 cm²/s** | ✅ correct, clean |
| Q2 | FRQ med | C=24x+14400/x, x=10√6, y=30√6, **C=480√6≈$1180** | ✅ correct; **excellent**; helpful labeled figure renders |
| Q3 | FRQ hard | x²+y²=100; dy/dt=−0.3; dA/dt=0.7; A max at x=5√2 → **25 m²** | ✅ correct; **excellent** multi-part (related rates + optimization in one) |
| Q4 | MCQ med | 5-12-13; dy/dt=−(5/12)(0.5)=**−0.208 m/s** | ✅ correct; minor: "how fast sliding down" vs signed answer |
| Q5 | MCQ hard | C=0.08x²+6400/x, x³=40000 → **x=20∛5≈34.2 cm** | ✅ correct; good distractors |

## Defects found

0. **[P1 · confirmed · FIXED] The AI Workshop could publish mathematically wrong revisions, unchecked.**
   Asked to "clean up" the tangent–secant problem (Geo Q2), the AI Workshop returned a confident
   revision whose **answer does not solve the problem it wrote**:
   - Revised problem: arcs (8x+6)° and (4x−2)°, exterior angle 47°. Correct solution: x = 21.5,
     **arc TB = 178°**.
   - The AI's published solution silently swapped x=21.5 → **x=20** (which doesn't satisfy the
     equation) to force a rounder number, reported **166°**, and "verified" against **44°** — the
     *old* problem's angle, not the new 47°.
   - It was one **Accept** click from publishing to students. Nothing verified it.

   **Root cause (code-grounded):** `api/core/question_bank_chat.py` has the chat LLM emit the new
   `question` + `solution_steps` + `final_answer` in a single pass and surfaces it as accept-ready with
   **no independent check** (the source even notes "a bad proposal is one click away from being
   applied"). By contrast, first-pass generation *separates* the steps — it generates the question,
   then independently solves it with `decompose_problem` (`api/core/step_decomposition.py`). The
   Workshop bypasses that solve+verify. So this is an **architecture/verification gap, not a prompt
   bug** — a prompt tweak would only lower the rate, not guarantee correctness.

   **Fix applied (reuses existing infra; no CAS — that was declined for grading):**
   When a workshop proposal changes the **question**, `chat_with_bank_item` now discards the chat's
   inline solution and re-solves the new question with the **same `generate_solutions` →
   `decompose_problem` path first-pass generation uses**, taking the solution steps + final answer from
   the solver. The chat owns the question text (+ figure); the solver owns the answer — identical to
   generation. The chat's prose reply is also replaced with a neutral note so it can't assert a
   contradictory number next to the verified preview. Solution-only edits (no question change) are left
   untouched, so a teacher's "make step 3 concise" request isn't overwritten.
   See [`FIXES.md`](./FIXES.md) → *AI Workshop re-solve*.

   **Verification:**
   - **Live (same request, before→after):** the exact "clean up" prompt that produced the fudged
     **166°** now returns the solver's correct **178°** in the proposal.
   - **Regression tests:** `tests/test_question_bank_chat.py::TestQuestionRewriteReSolve` — (a) a
     question rewrite takes the solver's answer, not the chat's fudge; (b) a solution-only edit does
     **not** trigger a re-solve. Full suite green (87 passed).

   **In this run:** the originally-accepted bad revision was reverted, so the golden set keeps the
   correct problem. Screenshots `shots/05_geo_workshop_proposal.png` / `06_geo_workshop_accepted.png`
   show the **pre-fix** behavior (the flaw, captured live).

1. **[BUG · confirmed · fixed] Geometry figures silently dropped.**
   The AI emits a circle `figure_spec` whose `chord_labels`/`point_labels` reference a chord or
   point it never declared (e.g. a tangent segment `TA`, or an external point `P`), and a strict
   Pydantic validator **rejects the entire figure** — so the problem saves with no diagram.
   Hit 2 of 5 geometry questions (Q2, Q3). Root cause: a cross-field constraint the JSON schema
   can't express + the prose doesn't restate, enforced by a fatal `raise` — even though the
   renderer already ignores unmatched label keys, so the strictness buys nothing.
   **Fix applied:** the validator now drops unmatched label keys instead of raising
   (`api/core/geometry/dsl.py`), turning a figure-dropping crash into a graceful degrade.
   Covered by a regression test. See `FIXES.md`.

2. **[QUALITY] Geometry Q2 — ugly answer + over-specified.** Internally consistent, but a
   "medium" problem shouldn't resolve to x=46/3 and an arc of 386/3°. It also pins both arcs
   *and* the angle, which is awkward. The AI-Workshop attempt to fix it produced wrong math
   (finding 0), so it was reverted — the original correct-but-ugly version is what ships.

3. **[QUALITY] Geometry Q5 — figure doesn't match the problem.** The problem is about two
   secants from an external point; the rendered figure draws two interior chords with no external
   point. The figure validated and rendered, so no bug fired — but it's pedagogically wrong.

4. **[MINOR] Calculus Q4 — sign/phrasing.** Asks "how fast is the top sliding down" (a speed)
   but the keyed answer is signed (−0.208). Cosmetic.

## Takeaway

Generation quality from real teacher materials is **high**: every problem was mathematically sound and
most were genuinely well-crafted for an accelerated course. The run surfaced two real defects, **both
now fixed**:

- **AI Workshop could ship wrong math, unchecked (P1, finding 0) — fixed.** A question rewrite is now
  re-solved by the same trusted solver the rest of the pipeline uses, so the answer is verified, not
  free-handed. Live-confirmed (166° → 178°) + regression tests.
- **Figure validator was over-strict — fixed.** Dropped geometry diagrams; traced to one validator and
  fixed with a test.

Net: generation is the strength, and the review-side correctness gap that the run exposed has been
closed deterministically by reusing infrastructure that already existed.
