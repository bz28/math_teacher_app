# Golden Set — Problem Creation & Review, End to End

A real, hand-verified run of Veradic's **create-homework-from-your-materials → refine-with-AI → publish**
flow. One teacher, two accelerated courses, real teacher worksheets as source material, ~5 problems
generated per course, every problem independently re-solved, then the AI Workshop and figure pipeline
stress-tested (which surfaced — and got us to fix — two real bugs).

Built to do double duty: a **customer demo** ("here's how good this is, start to finish") and an
**internal quality benchmark** ("here's exactly how sound the generated math is, and what we fixed").

---

## The story in one minute

A teacher (Dr. Avery Stone) sets up two courses — **Accelerated Geometry** (unit: Circle Theorems)
and **Calculus** (unit: Applications of the Derivative). For each, she:

1. **Uploads her own materials** — real worksheets (Kuta Software circle-theorem sheets; a related-
   rates + optimization handout). See [`materials/`](./materials).
2. **Generates problems** from those materials with a short focus prompt — no problem text, no figures,
   no answers written by hand. The model reads the worksheets and invents new problems, diagrams, and
   full solutions.
3. **Reviews each problem** in a queue with an **AI Workshop** side-panel — edits, asks the AI to
   revise, then approves.

**Result:** 10/10 generated problems were mathematically correct. Exercising the review tools then
surfaced two real bugs — the AI Workshop could ship a wrong answer on a rewrite, and a strict validator
silently dropped some figures — **both root-caused and fixed on this branch**, with tests.

---

## Walkthrough (screenshots)

**1. The teacher's courses** — Golden Set Academy, two accelerated courses.

![Teacher dashboard](./shots/01_teacher_dashboard.png)

**2. Generated homework** — five problems the model produced for *Circle Theorems*, grounded in the
uploaded worksheets (mix of free-response and multiple-choice).

![Geometry homework, generated](./shots/02_geo_homework_generated.png)

**3. The review queue** — each problem with its rendered figure, full solution, and answer key, plus
the **AI Workshop** assistant on the right.

![Geometry review queue](./shots/03_geo_review_queue.png)

**4. A problem worth refining** — the tangent–secant problem is *correct* but its numbers resolve to an
ugly fraction (arc = 386/3°). Exactly the kind of thing a teacher would ask the AI to clean up.

![Tangent-secant problem, before](./shots/04_geo_q_tangent_before.png)

**5. The AI Workshop proposes a rewrite — and this is where it gets interesting.** The teacher asks for
whole-number values; the model returns a confident, plausible-looking revision (shown as a preview
before anything is committed).

![AI Workshop proposal](./shots/05_geo_workshop_proposal.png)

**6. …but the revision is mathematically wrong — and that exposed a real bug we then fixed.**
Independent re-derivation shows the proposed answer (166°) does not solve the problem the AI wrote (the
correct answer is 178°): its solution silently swaps x=21.5 for x=20 and "verifies" against the old 44°
instead of the new 47°. A teacher who clicks **Accept** without checking — as the screenshot shows —
would publish broken math, because the Workshop trusted the chat to grade its own rewrite.

![AI Workshop accepted — pre-fix behavior](./shots/06_geo_workshop_accepted.png)

**The fix (shipped on this branch).** The Workshop now re-solves any question rewrite with the *same
trusted solver the rest of the generation pipeline uses*, and takes the answer from the solver — not
from the chat's free-hand solution. Verified live: the exact same "clean it up" request that produced
the fudged **166°** now returns the solver's correct **178°**, with regression tests to keep it that
way. This is the single most valuable thing the run surfaced — a real "AI editor ships wrong math"
defect, found live and **closed deterministically by reusing existing infrastructure**. Full root cause
+ fix + verification: [`qa-report.md`](./qa-report.md) → *finding 0* and [`FIXES.md`](./FIXES.md).
*(The screenshots above show the pre-fix behavior, captured during the run.)*

**7. Calculus, reviewed and approved** — the same flow on a genuinely hard multi-part related-rates +
optimization problem (all five calculus problems verified correct and approved).

![Calculus review](./shots/07_calc_review_queue.png)

![Calculus, all approved](./shots/08_calc_all_approved.png)

A screen recording of the whole flow: [`shots/video/golden-flow.webm`](./shots/video/golden-flow.webm).

---

## What's in this folder

| Path | What it is |
|------|-----------|
| [`README.md`](./README.md) | This walkthrough |
| [`materials/`](./materials) | The real worksheets used as generation source |
| [`dataset/PROBLEMS.md`](./dataset/PROBLEMS.md) | All 10 generated problems — question, answer, full solution (human-readable) |
| [`dataset/dataset.json`](./dataset/dataset.json) | The same, as structured JSON |
| [`qa-report.md`](./qa-report.md) | Independent re-derivation of every problem + the defect list |
| [`FIXES.md`](./FIXES.md) | The figure-rendering bug: root cause + the fix + its test |
| [`shots/`](./shots) | Step-by-step screenshots + the screen recording |

---

## How it was generated (full transparency)

The generator received **only** the uploaded worksheet images plus a short natural-language focus and
the standard dropdowns (count, FRQ/MCQ, difficulty, answer form). No problem text, figure geometry, or
answers were authored by hand — the model produced all of it. The exact focus prompts used:

- **Geometry (FRQ):** *"Honors/accelerated level. Mix inscribed angles, tangent–secant angle
  relationships, and power-of-a-point segment lengths… Require multi-step reasoning — set up and solve
  an equation — not one-step recall. Describe each figure clearly. Match the notation and rigor of the
  attached worksheets."*
- **Calculus (FRQ):** *"Accelerated free-response on applications of the derivative: related rates
  (one) and optimization (one), plus one mixed. Require defining variables, the relating equation,
  differentiating w.r.t. time where relevant, and a final answer with units."*

This is a representative *engaged-teacher* prompt (names subtopics and rigor, as a real teacher would —
that is what the Focus field is for). A *bare-minimum* prompt ("make 5 problems for this unit") is a
worthwhile future stress test.

**Model:** `claude-sonnet-4-6`. **Reproduce:** the run is scripted —
[`scripts/seed_golden_set.py`](../../scripts/seed_golden_set.py) seeds the world and
[`scripts/golden_capture.py`](../../scripts/golden_capture.py) drives + screenshots the flow.
