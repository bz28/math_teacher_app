"""Data prep for the Veradic teacher<->student cycle demo recording.

Idempotent. Re-seeds ONE coherent assignment — "Unit 5 Review" (General
Math · Period 3, Ms. Rivera) — whose SAME three problems flow through the
ENTIRE loop (generate → submit → understanding-check → grade → insights →
reteach). Nothing evaporates between scenes.

The three verified problems (math self-checked in the code below):
  1. Matrix system   2x+5y=16, 3x−y=3  → x=31/17, y=42/17  (inverse matrix)
  2. Right triangle   15-ft ladder @ 58° → h = 15·sin58° ≈ 12.7 ft  (+figure)
  3. Multi-step linear  4(x−2)+3 = 2x+5 → x = 5  (clean numeric root)

The loop that threads them:
  · GENERATE  — the three problems, framed as just-built from the worksheet.
  · WORKSHOP  — the matrix, edited in place to a no-solution system
                (2x+4y=6, 3x+6y=15 — verified inconsistent). The proposal is
                a pending chat message; the seeded matrix stays solvable for
                the rest of the loop.
  · SUBMIT    — a fresh student (Aisha) turns the sheet in.
  · CHECK     — Jordan got the MATRIX right but can't explain the inverse
                steps → flagged. Maya explains her method → exonerated.
  · GRADE     — Maya's RIGHT-TRIANGLE: perfect setup, one honest trig-value
                slip → obviously-fair 85% partial credit, itemized.
  · INSIGHTS  — five struggle concepts spanning the three + the roster.
  · RETEACH   — targets the top struggle (inverse-matrix systems).

Run:  PYTHONPATH=. .venv/bin/python -m scripts.cycle_video_prep
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.orm.attributes import flag_modified

from api.core.geometry import render_figure
from api.core.integrity_pipeline import compute_activity_summary
from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.course import Document
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.practice_activity import PracticeActivity
from api.models.question_bank import QuestionBankItem

# ── Known seed IDs (General Math · Period 3) ─────────────────────────
COURSE = "c99b654b-7ef8-4b05-a1df-a57c47d98f6e"       # → renamed "General Math"
SECTION = "845950c6-dc06-40a7-ba72-278ae63c221c"      # Period 3
UNIT = "5547f6d5-0487-4174-bae0-a25908900c68"         # holding unit
UNIT5 = "c072c9b6-fd0c-4565-9bab-afea06a3dcd4"        # → "Unit 5 Review" (the ONE hw)
PRACTICE_ASSIGNMENT = "f1b8b77e-706b-4d07-97fe-c808a8548ccf"  # published re-teach set
RETEACH_ASSIGNMENT = "8a852631-d500-4574-be94-536ea99f4f5a"   # draft (concept holders)

TEACHER_EMAIL = "td_teacher_d592cc@t.com"             # Ms. Rivera
MAYA_SUB = "34f22f8f-42fc-401e-a9d5-bb3d54bbd86d"     # Maya's Unit 5 submission
JORDAN_SUB = "729a070d-4250-497c-bdc7-887e3280fa29"   # Jordan's Unit 5 submission

# ── The three problems (fixed IDs so re-runs are clean) ──────────────
MATRIX_ITEM = "a1b2c3d4-0001-4001-8001-000000000001"
RIGHTTRI_ITEM = "a1b2c3d4-0002-4002-8002-000000000002"
MULTILIN_ITEM = "a1b2c3d4-0003-4003-8003-000000000003"
UNIT5_PROBLEMS = [MATRIX_ITEM, RIGHTTRI_ITEM, MULTILIN_ITEM]

# 1 ─ Matrix system, solved by the inverse.  Verified:
#     det = 2(−1) − 5(3) = −17.  A⁻¹ = (1/17)[[1,5],[3,−2]].
#     x = (1/17)(1·16 + 5·3) = 31/17 ;  y = (1/17)(3·16 − 2·3) = 42/17.
#     Check: 2(31/17)+5(42/17) = 272/17 = 16 ✓ ; 3(31/17)−42/17 = 51/17 = 3 ✓
MATRIX = {
    "id": MATRIX_ITEM,
    "title": "Systems — inverse matrix",
    "question": (
        r"Solve the system using an inverse matrix: "
        r"$\begin{cases} 2x + 5y = 16 \\ 3x - y = 3 \end{cases}$"
    ),
    "final_answer": r"$x = \dfrac{31}{17}, \quad y = \dfrac{42}{17}$",
    "solution_steps": [
        {"title": "Write it as a matrix equation",
         "description": (
             r"Put the coefficients, the unknowns, and the constants into matrices "
             r"— $A\mathbf{x} = \mathbf{b}$:"
             "\n\n"
             r"$$\begin{pmatrix} 2 & 5 \\ 3 & -1 \end{pmatrix}"
             r"\begin{pmatrix} x \\ y \end{pmatrix} = "
             r"\begin{pmatrix} 16 \\ 3 \end{pmatrix}$$")},
        {"title": "Find the determinant",
         "description": (
             r"$\det A = (2)(-1) - (5)(3) = -2 - 15 = -17.$  "
             r"It's non-zero, so $A$ is invertible and the system has a unique solution.")},
        {"title": "Invert the matrix",
         "description": (
             r"For a $2\times2$ matrix, swap the diagonal, negate the off-diagonal, "
             r"and divide by the determinant:"
             "\n\n"
             r"$$A^{-1} = \frac{1}{-17}\begin{pmatrix} -1 & -5 \\ -3 & 2 \end{pmatrix} "
             r"= \frac{1}{17}\begin{pmatrix} 1 & 5 \\ 3 & -2 \end{pmatrix}$$")},
        {"title": "Multiply to solve",
         "description": (
             r"$\mathbf{x} = A^{-1}\mathbf{b}$:"
             "\n\n"
             r"$$\frac{1}{17}\begin{pmatrix} 1 & 5 \\ 3 & -2 \end{pmatrix}"
             r"\begin{pmatrix} 16 \\ 3 \end{pmatrix} = "
             r"\frac{1}{17}\begin{pmatrix} 16 + 15 \\ 48 - 6 \end{pmatrix} = "
             r"\frac{1}{17}\begin{pmatrix} 31 \\ 42 \end{pmatrix}$$"
             "\n\n"
             r"So $x = \dfrac{31}{17}$ and $y = \dfrac{42}{17}$.")},
    ],
}

# 2 ─ Right-triangle trig, WITH a self-verifying figure.  Verified:
#     h = 15·sin58° = 15(0.8480) = 12.72 → 12.7 ft.
RIGHTTRI_SPEC = {
    "type": "geometry", "shape": "triangle", "vertices": ["G", "C", "T"],
    "right_angle_at": ["C"], "angles": {"G": 58},
    "side_lengths": {"GT": 15},
    "angle_labels": {"G": "58°"},
    "side_labels": {"GT": "15 ft", "CT": "h"},
}
RIGHTTRI = {
    "id": RIGHTTRI_ITEM,
    "title": "Right triangle — ladder",
    "question": (
        r"A 15-ft ladder leans against a wall, making a $58^\circ$ angle with the "
        r"ground. How high up the wall does the ladder reach? Round to the nearest "
        r"tenth of a foot."),
    "final_answer": r"$h = 15\sin 58^\circ \approx 12.7\text{ ft}$",
    "solution_steps": [
        {"title": "Pick the right ratio",
         "description": (
             r"The ladder is the **hypotenuse** (15 ft) and the height $h$ is the "
             r"side **opposite** the $58^\circ$ angle. Opposite over hypotenuse is "
             r"sine: $\sin 58^\circ = \dfrac{h}{15}.$")},
        {"title": "Solve for the height",
         "description": r"Multiply both sides by 15:  $h = 15\sin 58^\circ.$"},
        {"title": "Evaluate",
         "description": (
             r"$\sin 58^\circ \approx 0.848$, so "
             r"$h \approx 15(0.848) = 12.72 \approx 12.7\text{ ft}.$")},
    ],
}

# 3 ─ Multi-step linear, REGENERATED to a clean numeric root x = 5.
#     4(x−2)+3 = 4x−5.  4x−5 = 2x+5 → 2x = 10 → x = 5.
#     Check: 4(5−2)+3 = 15 ; 2(5)+5 = 15 ✓
MULTILIN = {
    "id": MULTILIN_ITEM,
    "title": "Multi-step linear",
    "question": r"Solve for $x$:  $4(x - 2) + 3 = 2x + 5$",
    "final_answer": r"$x = 5$",
    "solution_steps": [
        {"title": "Distribute, then combine",
         "description": (
             r"$4(x - 2) + 3 = 4x - 8 + 3 = 4x - 5.$  "
             r"The equation is now $4x - 5 = 2x + 5.$")},
        {"title": "Collect the variables",
         "description": r"Subtract $2x$ from both sides:  $2x - 5 = 5.$"},
        {"title": "Isolate x",
         "description": r"Add 5:  $2x = 10$, then divide by 2:  $x = 5.$"},
    ],
}

# ── The MATRIX understanding CATCH (Jordan) ──────────────────────────
# Jordan got the matrix system RIGHT (x=31/17, y=42/17) with clean written
# steps — but can't say why the inverse solves it, why we divide by the
# determinant, or adapt to a tweak. That's the signal a grade can't see.
JORDAN_MATRIX_STEPS = [
    {"problem_position": 1, "step_num": 1,
     "latex": r"\begin{pmatrix} 2 & 5 \\ 3 & -1 \end{pmatrix}\begin{pmatrix} x \\ y \end{pmatrix} = \begin{pmatrix} 16 \\ 3 \end{pmatrix}", "plain_english": ""},
    {"problem_position": 1, "step_num": 2, "latex": r"\det A = -17", "plain_english": ""},
    {"problem_position": 1, "step_num": 3,
     "latex": r"A^{-1} = \frac{1}{17}\begin{pmatrix} 1 & 5 \\ 3 & -2 \end{pmatrix}", "plain_english": ""},
    {"problem_position": 1, "step_num": 4, "latex": r"x = \frac{31}{17},\ y = \frac{42}{17}", "plain_english": ""},
]
JORDAN_WORK_EXTRACTION = {
    "steps": JORDAN_MATRIX_STEPS,
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"x = \frac{31}{17},\ y = \frac{42}{17}",
         "answer_plain": "x = 31/17, y = 42/17"},
    ],
    "confidence": 0.94,
}
# Jordan is correct on all three → a clean 100%. The flag sits on a perfect
# score, which is exactly the point.
JORDAN_FINAL_ANSWERS = {
    MATRIX_ITEM: "x = 31/17, y = 42/17",
    RIGHTTRI_ITEM: "12.7 ft",
    MULTILIN_ITEM: "x = 5",
}
JORDAN_TURNS = [
    ("agent",
     "Hi Jordan — nice work. Your answer to the matrix system, "
     r"$x = \tfrac{31}{17}$, $y = \tfrac{42}{17}$, is exactly right. I just want to "
     "hear your thinking. How did you know to use the inverse matrix here?"),
    ("student",
     "That's just the method for these. I set it up and it came out to 31/17 and "
     "42/17."),
    ("agent",
     r"Right idea. When you found $A^{-1}$, you divided by the determinant, $-17$. "
     "Where does that come from — why divide by it?"),
    ("student",
     "I'm not really sure why, that's just the formula. I put it in my calculator."),
    ("agent",
     r"No worries — one more and we're done. If the second equation were "
     r"$3x - y = 5$ instead of $3x - y = 3$, what in your work would change?"),
    ("student",
     "I don't know. I'd just redo the whole thing the same way."),
    ("agent",
     "Thanks, Jordan — that's really helpful, exactly what I needed. We're all set "
     "here!"),
]
_TEL_AT = "2026-06-30T15:42:00Z"
JORDAN_TURN_TELEMETRY = {
    1: {  # pasted the answer + tabbed away while "explaining"
        "focus_blur_events": [{"at": _TEL_AT, "duration_ms": 13000}],
        "paste_events": [{"at": _TEL_AT, "byte_count": 96}],
        "typing_cadence": {"total_ms": 9000, "pauses_over_3s": 2, "edits": 1},
        "device_type": "desktop", "need_more_time_used": False,
    },
    3: {  # tabbed away again
        "focus_blur_events": [{"at": _TEL_AT, "duration_ms": 7000}],
        "paste_events": [],
        "typing_cadence": {"total_ms": 6000, "pauses_over_3s": 1, "edits": 0},
        "device_type": "desktop", "need_more_time_used": False,
    },
}
JORDAN_TURN_SECONDS = {1: 40, 3: 18, 5: 22}

# ── Maya's EXONERATION (same matrix, explained in her own words) ─────
MAYA_TURNS = [
    ("agent",
     "Thanks for turning that in, Maya! Quick check on the matrix system. You wrote "
     r"it as $A\mathbf{x} = \mathbf{b}$ and used the inverse. Why does multiplying by "
     r"$A^{-1}$ actually solve for $x$ and $y$?"),
    ("student",
     "Because A-inverse times A is the identity matrix, so it cancels the A on the "
     "left and leaves just x and y. It's like dividing both sides by the matrix, so "
     "x = A-inverse times b."),
    ("agent",
     r"Exactly — that's the whole idea. And the $\tfrac{1}{-17}$ out front, where "
     "does that come from?"),
    ("student",
     "That's one over the determinant. The inverse formula swaps the diagonal, flips "
     "the sign on the other two, and divides everything by the determinant, which was "
     "2 times -1 minus 5 times 3, so -17."),
    ("agent",
     "That's a clear, complete explanation — you understand exactly why each step "
     "works. Thanks for talking it through!"),
]
MAYA_MATRIX_STEPS = [  # her correct matrix work (probed problem, position 1)
    {"problem_position": 1, "step_num": 1,
     "latex": r"A\mathbf{x} = \mathbf{b},\ A = \begin{pmatrix} 2 & 5 \\ 3 & -1 \end{pmatrix}", "plain_english": ""},
    {"problem_position": 1, "step_num": 2, "latex": r"\det A = 2(-1) - 5(3) = -17", "plain_english": ""},
    {"problem_position": 1, "step_num": 3,
     "latex": r"A^{-1} = \frac{1}{17}\begin{pmatrix} 1 & 5 \\ 3 & -2 \end{pmatrix}", "plain_english": ""},
    {"problem_position": 1, "step_num": 4, "latex": r"x = \frac{31}{17},\ y = \frac{42}{17}", "plain_english": ""},
]
MAYA_MATRIX_EXTRACTION = {
    "steps": MAYA_MATRIX_STEPS,
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"x = \frac{31}{17},\ y = \frac{42}{17}",
         "answer_plain": "x = 31/17, y = 42/17"},
    ],
    "confidence": 0.92,
}

# ── Maya's GRADE: the right-triangle, one honest trig-value slip ─────
# Perfect setup (sine, opposite/hypotenuse) but evaluated sin58° ≈ 0.79
# (that's nearer sin52°) → 11.8 ft instead of 12.7. One fair deduction.
#   100 − 15 = 85%.
MAYA_ALL_STEPS = MAYA_MATRIX_STEPS + [
    {"problem_position": 2, "step_num": 1, "latex": r"\sin 58^\circ = \frac{h}{15}", "plain_english": ""},
    {"problem_position": 2, "step_num": 2, "latex": r"h = 15\sin 58^\circ", "plain_english": ""},
    {"problem_position": 2, "step_num": 3, "latex": r"h = 15(0.79)", "plain_english": ""},
    {"problem_position": 2, "step_num": 4, "latex": r"h \approx 11.8\text{ ft}", "plain_english": ""},
    {"problem_position": 3, "step_num": 1, "latex": r"4x - 8 + 3 = 2x + 5", "plain_english": ""},
    {"problem_position": 3, "step_num": 2, "latex": r"2x = 10", "plain_english": ""},
    {"problem_position": 3, "step_num": 3, "latex": r"x = 5", "plain_english": ""},
]
MAYA_FINAL_ANSWERS = {
    MATRIX_ITEM: "x = 31/17, y = 42/17",
    RIGHTTRI_ITEM: "11.8 ft",
    MULTILIN_ITEM: "x = 5",
}
MAYA_RIGHTTRI_DEDUCTIONS = [
    {"points_off": 15,
     "reason": "Used sin 58° ≈ 0.79 (nearer sin 52°); it's ≈ 0.85, so h = 12.7 ft, not 11.8",
     "step_ref": 3},
]

# ── Student A..H email-prefix → realistic name (status-ordered) ──────
RENAMES = {
    "student_66a7": "Liam Walsh", "student_7093": "Sofia Reyes",
    "student_4f62": "Daniel Brooks", "student_826b": "Priya Nair",
    "student_56d1": "Marcus Lee", "student_c41a": "Emma Torres",
    "student_bd8f": "Olivia Grant", "student_bb09": "Ethan Park",
}

# ── Class struggle picture (insights + reteach), spanning the 3 ──────
# "f"=first_try  "r"=retry(struggled)  "x"=revealed(struggled)  "-"=didn't do.
ACTIVE = ["Liam Walsh", "Sofia Reyes", "Daniel Brooks", "Priya Nair",
          "Marcus Lee", "Emma Torres", "Olivia Grant", "Ethan Park"]
STRUGGLE_CONCEPTS = [
    ("Solving 2×2 systems with an inverse matrix", ["x", "r", "x", "r", "r", "f", "f", "r"]),  # 6/8
    ("Right-triangle trigonometry (SOH-CAH-TOA)",  ["r", "r", "x", "r", "r", "f", "f", "f"]),  # 5/8
    ("Setting up a trig ratio from a word problem", ["x", "r", "r", "r", "f", "f", "-", "f"]),  # 4/7
    ("Multi-step equations with variables on both sides", ["r", "f", "x", "f", "f", "f", "f", "f"]),  # 2/8
    ("Distributing before combining like terms",   ["r", "f", "f", "f", "f", "f", "f", "f"]),  # 1/8
]
_OUTCOME = {"f": "first_try", "r": "retry", "x": "revealed"}

# ── The re-teach set: clean MCQs on the top struggle (systems) ──────
RETEACH_TITLE = "Re-teach: Solving 2×2 systems with an inverse matrix"
PRACTICE_PROBLEMS = [
    {
        "title": "Determinant of a 2×2",
        "question": r"Find the determinant:  $\det\begin{pmatrix} 2 & 5 \\ 3 & -1 \end{pmatrix}$",
        "final_answer": r"$-17$",
        "distractors": [r"$17$", r"$-13$", r"$13$"],
        "solution_steps": [
            {"title": "Cross-multiply the diagonals",
             "description": r"For $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$, the determinant is $ad - bc$."},
            {"title": "Plug in",
             "description": r"$ad - bc = (2)(-1) - (5)(3) = -2 - 15 = -17.$"},
            {"title": "Why it matters",
             "description": r"A non-zero determinant means the matrix is invertible — the system has exactly one solution."},
        ],
    },
    {
        "title": "How many solutions?",
        "question": r"How many solutions does this system have?  $\begin{cases} 2x + 4y = 6 \\ 3x + 6y = 15 \end{cases}$",
        "final_answer": r"No solution",
        "distractors": [r"Exactly one", r"Infinitely many", r"Exactly two"],
        "solution_steps": [
            {"title": "Check the determinant",
             "description": r"$\det\begin{pmatrix} 2 & 4 \\ 3 & 6 \end{pmatrix} = (2)(6) - (4)(3) = 12 - 12 = 0.$  A zero determinant means no unique solution."},
            {"title": "Are the lines the same or parallel?",
             "description": r"Scale the first equation by $1.5$:  $3x + 6y = 9.$  But the second says $3x + 6y = 15.$  Same left side, different right side."},
            {"title": "Conclusion",
             "description": r"The lines are **parallel** and never meet — the system is inconsistent, so there is **no solution**."},
        ],
    },
    {
        "title": "Solve the system",
        "question": r"Solve:  $\begin{cases} x + y = 5 \\ x - y = 1 \end{cases}$",
        "final_answer": r"$(3,\ 2)$",
        "distractors": [r"$(2,\ 3)$", r"$(4,\ 1)$", r"$(1,\ 4)$"],
        "solution_steps": [
            {"title": "Add the equations",
             "description": r"Adding cancels $y$:  $(x + y) + (x - y) = 5 + 1$, so $2x = 6$ and $x = 3.$"},
            {"title": "Back-substitute",
             "description": r"From $x + y = 5$ with $x = 3$:  $y = 2.$"},
            {"title": "Answer",
             "description": r"The solution is $(x, y) = (3, 2).$  Check: $3 + 2 = 5$ ✓ and $3 - 2 = 1$ ✓."},
        ],
    },
]


def _new_item(spec: dict, *, figure_spec=None, figure_svg=None) -> QuestionBankItem:
    return QuestionBankItem(
        id=uuid.UUID(spec["id"]),
        course_id=uuid.UUID(COURSE), unit_id=uuid.UUID(UNIT),
        originating_assignment_id=uuid.UUID(UNIT5),
        title=spec["title"], question=spec["question"],
        final_answer=spec["final_answer"], solution_steps=spec["solution_steps"],
        difficulty="medium", format="frq", status="approved",
        figure_spec=figure_spec, figure_svg=figure_svg,
    )


async def main() -> None:
    async with get_session_factory()() as s:
        now = datetime.now(UTC)

        # 1 ── the class identity: General Math, taught by Ms. Rivera ──
        await s.execute(text("update courses set name='General Math' where id=:c"), {"c": COURSE})
        await s.execute(text("update users set name='Ms. Rivera' where email=:e"), {"e": TEACHER_EMAIL})
        print("named the class 'General Math' and the teacher 'Ms. Rivera'")

        # 1a ── rename placeholder students ──────────────────────────
        renamed = 0
        for prefix, name in RENAMES.items():
            res = await s.execute(text("update users set name=:n where email like :e"),
                                  {"n": name, "e": f"{prefix}@%"})
            renamed += res.rowcount or 0
        print(f"renamed {renamed} students")

        # 1b ── suppress first-run onboarding tours for the actors ────
        await s.execute(text(
            "update users set tours_seen = '[\"student\",\"teacher\",\"personal\"]'::jsonb "
            "where email in (:t,'maya_d52a@school.edu','jordan_a395@school.edu','aisha_bd62@school.edu')"),
            {"t": TEACHER_EMAIL})
        # 1c ── stamp Period 3 students with the course's school (SPA gate)
        await s.execute(text(
            "update users set school_id = (select c.school_id from courses c where c.id=:c)"
            " where id in (select se.student_id from section_enrollments se where se.section_id=:s)"),
            {"c": COURSE, "s": SECTION})
        print("stamped Period 3 students with the course school")

        # 2 ── author the THREE Unit 5 Review problems ───────────────
        await s.execute(text("delete from question_bank_items where id = any(:ids)"),
                        {"ids": UNIT5_PROBLEMS})
        rt_svg = render_figure(RIGHTTRI_SPEC)
        s.add(_new_item(MATRIX))
        s.add(_new_item(RIGHTTRI, figure_spec=RIGHTTRI_SPEC, figure_svg=rt_svg))
        s.add(_new_item(MULTILIN))
        await s.flush()
        # Rename the ONE assignment + point it at the three problems.
        await s.execute(
            text("update assignments set title='Unit 5 Review', status='published', "
                 "content=:c where id=:a"),
            {"c": json.dumps({"problem_ids": UNIT5_PROBLEMS}), "a": UNIT5})
        # Clean, future due date → no "late" banner on the submit scene.
        await s.execute(text("update assignments set due_at=:d, integrity_check_enabled=true, "
                             "ai_grading_enabled=true where id=:a"),
                        {"d": now + timedelta(days=14), "a": UNIT5})
        print(f"seeded Unit 5 Review with 3 problems (figure svg {len(rt_svg)} chars)")

        # 2b ── the re-teach set: 3 clean MCQs on inverse-matrix systems
        await s.execute(text("delete from question_bank_items where originating_assignment_id=:a"),
                        {"a": PRACTICE_ASSIGNMENT})
        new_ids: list[str] = []
        for spec in PRACTICE_PROBLEMS:
            item = QuestionBankItem(
                course_id=uuid.UUID(COURSE), unit_id=uuid.UUID(UNIT),
                originating_assignment_id=uuid.UUID(PRACTICE_ASSIGNMENT),
                title=spec["title"], question=spec["question"],
                final_answer=spec["final_answer"], distractors=spec["distractors"],
                solution_steps=spec["solution_steps"], difficulty="medium",
                format="mcq", status="approved",
            )
            s.add(item)
            await s.flush()
            new_ids.append(str(item.id))
        await s.execute(
            text("update assignments set content=:c, title=:t where id=:a"),
            {"c": json.dumps({"problem_ids": new_ids}), "t": RETEACH_TITLE,
             "a": PRACTICE_ASSIGNMENT})
        print(f"seeded {len(new_ids)} MCQ re-teach problems on '{RETEACH_TITLE}'")

        # 2c ── rebuild the class struggle picture (insights + reteach)
        sid_by_name = {}
        for name in ACTIVE:
            sid = (await s.execute(text(
                "select u.id from users u join section_enrollments se on se.student_id=u.id "
                "where se.section_id=:s and u.name=:n"), {"s": SECTION, "n": name})).scalar()
            sid_by_name[name] = sid
        await s.execute(text("delete from practice_activity where section_id=:s"), {"s": SECTION})
        await s.execute(text(
            "delete from question_bank_items where originating_assignment_id=:a and title = any(:t)"),
            {"a": RETEACH_ASSIGNMENT, "t": [c for c, _ in STRUGGLE_CONCEPTS]})
        acts = 0
        for ci, (title, outcomes) in enumerate(STRUGGLE_CONCEPTS):
            concept = QuestionBankItem(
                course_id=uuid.UUID(COURSE), unit_id=uuid.UUID(UNIT),
                originating_assignment_id=uuid.UUID(RETEACH_ASSIGNMENT),
                title=title, question=f"Practice: {title}", final_answer="$x$",
                difficulty="medium", format="frq", status="approved",
            )
            s.add(concept)
            await s.flush()
            for si, code in enumerate(outcomes):
                if code == "-":
                    continue
                s.add(PracticeActivity(
                    student_id=sid_by_name[ACTIVE[si]], section_id=uuid.UUID(SECTION),
                    practice_assignment_id=uuid.UUID(PRACTICE_ASSIGNMENT),
                    bank_item_id=concept.id, mode="practice", outcome=_OUTCOME[code],
                    created_at=now - timedelta(days=ci % 3, hours=si)))
                acts += 1
        print(f"rebuilt struggle picture: {len(STRUGGLE_CONCEPTS)} concepts, {acts} activities")

        # 2d ── deterministic source material for the generation wizard.
        # Wipe accumulated on-camera uploads, seed ONE persistent warm-up
        # material.  Scene 2 uploads worksheet.png on camera → 2 docs, so
        # the wizard's Source picker reads "1 of 2 selected".
        teacher_uid = (await s.execute(text("select id from users where email=:e"),
                                       {"e": TEACHER_EMAIL})).scalar()
        await s.execute(text("delete from documents where course_id=:c"), {"c": COURSE})
        _asset = os.environ.get("WORKSHEET_ASSET", "/tmp/cycle-assets/worksheet.png")
        if teacher_uid and os.path.exists(_asset):
            with open(_asset, "rb") as fh:
                _raw = fh.read()
            s.add(Document(
                course_id=uuid.UUID(COURSE), teacher_id=teacher_uid, unit_id=uuid.UUID(UNIT),
                filename="Unit 5 warm-up — mixed review.png", file_type="image/png",
                file_size=len(_raw), image_data=base64.b64encode(_raw).decode()))
            print("seeded 1 warm-up material (scene 2 adds the worksheet on camera)")
        else:
            print(f"WARN: worksheet asset missing ({_asset})")

        # 3 ── Maya's COMPLETE understanding check — PASS (exonerated) ─
        sub_uuid = uuid.UUID(MAYA_SUB)
        existing = (await s.execute(select(IntegrityCheckSubmission.id)
                    .where(IntegrityCheckSubmission.submission_id == sub_uuid))).scalars().all()
        for cid in existing:
            await s.execute(delete(IntegrityConversationTurn).where(
                IntegrityConversationTurn.integrity_check_submission_id == cid))
            await s.execute(delete(IntegrityCheckProblem).where(
                IntegrityCheckProblem.integrity_check_submission_id == cid))
        await s.execute(delete(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == sub_uuid))
        check = IntegrityCheckSubmission(
            submission_id=sub_uuid, status="complete", disposition="pass",
            headline="Explained the inverse-matrix method in her own words",
            overall_summary=(
                "Maya explained why multiplying by A⁻¹ solves the system (A⁻¹A is the "
                "identity), and where the 1/det factor comes from — a clear, complete "
                "grasp of the method, in her own words."),
            probe_selection_reason="verified_hardest_correct", resolution="unresolved")
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id, bank_item_id=uuid.UUID(MATRIX_ITEM),
            sample_position=0, status="verdict_submitted",
            student_work_extraction=MAYA_MATRIX_EXTRACTION,
            rubric={"paraphrase_originality": "high", "causal_fluency": "high"},
            ai_reasoning=(
                "Explained the identity-matrix cancellation and the role of the "
                "determinant unprompted — genuine ownership of the inverse method."),
            selected_reason="verified_hardest_correct"))
        for i, (role, content) in enumerate(MAYA_TURNS):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=check.id, ordinal=i, role=role,
                content=content, seconds_on_turn=None, telemetry=None))
        print(f"seeded PASS understanding-check ({len(MAYA_TURNS)} turns) on Maya's matrix work")

        # 4 ── Maya's grade: 85% partial on the right-triangle ────────
        sub = (await s.execute(select(Submission).where(Submission.id == sub_uuid))).scalar_one()
        sub.extraction = {"steps": MAYA_ALL_STEPS, "final_answers": [
            {"problem_position": 1, "answer_latex": r"x = \frac{31}{17},\ y = \frac{42}{17}", "answer_plain": "x = 31/17, y = 42/17"},
            {"problem_position": 2, "answer_latex": r"h \approx 11.8\text{ ft}", "answer_plain": "11.8 ft"},
            {"problem_position": 3, "answer_latex": r"x = 5", "answer_plain": "x = 5"},
        ], "confidence": 0.9}
        sub.extraction_confirmed_at = sub.extraction_confirmed_at or now
        sub.final_answers = dict(MAYA_FINAL_ANSWERS)
        flag_modified(sub, "extraction")
        flag_modified(sub, "final_answers")

        grade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == sub_uuid))).scalar_one_or_none()
        if grade is None:
            grade = SubmissionGrade(submission_id=sub_uuid)
            s.add(grade)
        grade.breakdown = [
            {"problem_id": MATRIX_ITEM, "score_status": "correct", "percent": 100.0,
             "confidence": 0.95, "feedback": "Correct — clean inverse-matrix solution.",
             "deductions": [], "student_answer": "x = 31/17, y = 42/17"},
            {"problem_id": RIGHTTRI_ITEM, "score_status": "partial", "percent": 85.0,
             "confidence": 0.92,
             "feedback": ("Setup is perfect — sine, opposite over hypotenuse. The only "
                          "slip is the value: sin 58° ≈ 0.85, not 0.79, so the height "
                          "should be 12.7 ft, not 11.8."),
             "deductions": MAYA_RIGHTTRI_DEDUCTIONS, "student_answer": "11.8 ft"},
            {"problem_id": MULTILIN_ITEM, "score_status": "correct", "percent": 100.0,
             "confidence": 0.95, "feedback": "Correct.", "deductions": [], "student_answer": "x = 5"},
        ]
        grade.ai_breakdown = {"grades": [
            {"problem_position": 1, "student_answer": "x = 31/17, y = 42/17",
             "score_status": "correct", "percent": 100.0, "confidence": 0.95,
             "reasoning": "Inverse-matrix method correct; answer matches the key.",
             "student_feedback": "Correct.", "deductions": []},
            {"problem_position": 2, "student_answer": "11.8 ft",
             "score_status": "partial", "percent": 85.0, "confidence": 0.92,
             "reasoning": ("Correct ratio and setup (sin = opp/hyp). Evaluated sin 58° "
                           "as 0.79 instead of ≈0.85, giving 11.8 ft instead of 12.7."),
             "student_feedback": ("Perfect setup — just recheck sin 58° (≈0.85); the "
                                  "height is 12.7 ft."),
             "deductions": MAYA_RIGHTTRI_DEDUCTIONS},
            {"problem_position": 3, "student_answer": "x = 5",
             "score_status": "correct", "percent": 100.0, "confidence": 0.95,
             "reasoning": "Distributed, collected, isolated correctly; x = 5.",
             "student_feedback": "Correct.", "deductions": []},
        ]}
        grade.final_score = sum(e["percent"] for e in grade.breakdown) / len(grade.breakdown)
        grade.ai_score = grade.final_score
        grade.graded_at = now
        grade.grade_published_at = None
        flag_modified(grade, "breakdown")
        flag_modified(grade, "ai_breakdown")
        print(f"seeded Maya's grade: matrix 100 · ladder 85 · linear 100 → {grade.final_score:.0f}%")

        # 4b ── Jordan's CATCH: right matrix, can't explain → flagged ─
        jsub_uuid = uuid.UUID(JORDAN_SUB)
        jsub = (await s.execute(select(Submission).where(Submission.id == jsub_uuid))).scalar_one()
        jsub.extraction = {"steps": JORDAN_MATRIX_STEPS, "final_answers": [
            {"problem_position": 1, "answer_latex": r"x = \frac{31}{17},\ y = \frac{42}{17}", "answer_plain": "x = 31/17, y = 42/17"},
        ], "confidence": 0.94}
        jsub.extraction_confirmed_at = jsub.extraction_confirmed_at or now
        jsub.final_answers = dict(JORDAN_FINAL_ANSWERS)
        flag_modified(jsub, "extraction")
        flag_modified(jsub, "final_answers")

        jgrade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == jsub_uuid))).scalar_one_or_none()
        if jgrade is None:
            jgrade = SubmissionGrade(submission_id=jsub_uuid)
            s.add(jgrade)
        jbreak, jai = [], []
        for pos, pid in enumerate(UNIT5_PROBLEMS, start=1):
            ans = JORDAN_FINAL_ANSWERS[pid]
            jbreak.append({"problem_id": pid, "score_status": "correct", "percent": 100.0,
                           "confidence": 0.95, "feedback": "Correct.", "deductions": [],
                           "student_answer": ans})
            jai.append({"problem_position": pos, "student_answer": ans, "score_status": "correct",
                        "percent": 100.0, "confidence": 0.95, "reasoning": "Matches the key.",
                        "student_feedback": "Correct.", "deductions": []})
        jgrade.breakdown = jbreak
        jgrade.ai_breakdown = {"grades": jai}
        jgrade.final_score = 100.0
        jgrade.ai_score = 100.0
        jgrade.graded_at = now
        jgrade.grade_published_at = None
        flag_modified(jgrade, "breakdown")
        flag_modified(jgrade, "ai_breakdown")

        jexisting = (await s.execute(select(IntegrityCheckSubmission.id)
                     .where(IntegrityCheckSubmission.submission_id == jsub_uuid))).scalars().all()
        for cid in jexisting:
            await s.execute(delete(IntegrityConversationTurn).where(
                IntegrityConversationTurn.integrity_check_submission_id == cid))
            await s.execute(delete(IntegrityCheckProblem).where(
                IntegrityCheckProblem.integrity_check_submission_id == cid))
        await s.execute(delete(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == jsub_uuid))
        jcheck = IntegrityCheckSubmission(
            submission_id=jsub_uuid, status="complete", disposition="flag_for_review",
            headline="Correct answer — but couldn't explain the inverse steps",
            overall_summary=(
                "Jordan's matrix answer (x = 31/17, y = 42/17) is correct and his written "
                "steps are clean — but he couldn't say why the inverse solves the system, "
                "why we divide by the determinant, or adapt to a small change. Worth a "
                "quick conversation before this counts."),
            probe_selection_reason="verified_hardest_correct", resolution="unresolved")
        s.add(jcheck)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=jcheck.id, bank_item_id=uuid.UUID(MATRIX_ITEM),
            sample_position=0, status="verdict_submitted",
            student_work_extraction=JORDAN_WORK_EXTRACTION,
            rubric={"paraphrase_originality": "low", "causal_fluency": "low",
                    "transfer": "low", "prediction": "not_probed",
                    "authority_resistance": "not_probed", "self_correction": "not_observed"},
            ai_reasoning=(
                "Answer and written steps are correct, but the student could not explain "
                "why the inverse solves the system, why we divide by the determinant, or "
                "adapt the setup to a modified constant — no causal grasp of the method."),
            selected_reason="verified_hardest_correct"))
        jturns = []
        for i, (role, content) in enumerate(JORDAN_TURNS):
            t = IntegrityConversationTurn(
                integrity_check_submission_id=jcheck.id, ordinal=i, role=role, content=content,
                seconds_on_turn=JORDAN_TURN_SECONDS.get(i), telemetry=JORDAN_TURN_TELEMETRY.get(i))
            s.add(t)
            jturns.append(t)
        jcheck.activity_summary = compute_activity_summary(jturns)
        flag_modified(jcheck, "activity_summary")
        _tot = (jcheck.activity_summary or {}).get("totals", {})
        print(f"seeded FLAG understanding-check ({len(JORDAN_TURNS)} turns) on Jordan's matrix work")
        print(f"  · behavior digest: {_tot.get('paste_count', 0)} paste, "
              f"{_tot.get('tab_out_count', 0)} tab-out")

        # 5 ── reset the matrix item's chat so the Workshop scene starts
        #       clean (the no-solution proposal is pre-warmed separately).
        mfig = (await s.execute(select(QuestionBankItem).where(
            QuestionBankItem.id == uuid.UUID(MATRIX_ITEM)))).scalar_one()
        mfig.chat_messages = []
        flag_modified(mfig, "chat_messages")

        await s.commit()
    print("prep complete")


if __name__ == "__main__":
    asyncio.run(main())
