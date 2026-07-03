"""Data prep for the Veradic teacher<->student cycle demo recording.

Idempotent. Re-seeds ONE coherent assignment — "Unit 5 Review" (General
Math · Period 3, Ms. Rivera) — whose SAME three problems flow through the
ENTIRE loop (generate → submit → understanding-check → grade → insights →
reteach). Nothing evaporates between scenes.

ALL content below is VERIFIED-REAL: every problem, key, workshop rewrite,
integrity transcript, and grade was run against the live app and captured
under docs/design/verify-matrix-mult/ (step1–4). Do not re-invent the math.

The three verified problems:
  1. Matrix MULTIPLICATION   A=[[5,2],[0,3]], B=[[1,4],[3,2]] → AB=[[11,24],[9,6]]
  2. Right triangle (zip-line, 48°, 35 ft) → h = 35·sin48° ≈ 26.0 ft  (+figure)
  3. Multi-step linear   3(x−2)/4 − (x+1)/3 = 2  →  x = 46/5  (honest fraction)

The loop that threads them:
  · GENERATE  — the three problems, framed as just-built from the worksheet.
  · WORKSHOP  — the matrix, edited in place: "Make this one undefined." → the
                AI makes B 3×2 (non-conformable), rewrites to "Can AB be
                computed? Check the dimensions," and shows the UPDATED
                SOLUTION (the conformability explanation). Pending proposal;
                the seeded matrix stays computable for the rest of the loop.
  · SUBMIT    — a fresh student (Aisha) turns the sheet in.
  · CHECK     — Jordan got the MATRIX product right but can't explain
                row×column → flagged. Maya explains row×column → passed.
  · GRADE     — Jordan all correct → 100% (the flagged perfect score).
                Maya: one honest slip on the matrix (AB₂₂: 3×2 as 5 not 6) →
                Partial 95% itemized; triangle + linear Full.
  · INSIGHTS  — five struggle concepts spanning the three + the roster.
  · RETEACH   — targets the top struggle (multiplying matrices).

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

# 1 ─ Matrix MULTIPLICATION.  Verified (step1):  AB = [[11,24],[9,6]].
#     (1,1)=5·1+2·3=11  (1,2)=5·4+2·2=24  (2,1)=0·1+3·3=9  (2,2)=0·4+3·2=6.
MATRIX = {
    "id": MATRIX_ITEM,
    "title": "Matrix multiplication — compute product AB",
    "question": (
        r"Compute the matrix product $AB$, where"
        "\n"
        r"$$A = \begin{bmatrix} 5 & 2 \\ 0 & 3 \end{bmatrix} \quad \text{and} \quad "
        r"B = \begin{bmatrix} 1 & 4 \\ 3 & 2 \end{bmatrix}.$$"
        "\n"
        r"Give each entry of the resulting $2 \times 2$ matrix."
    ),
    "final_answer": r"$AB = \begin{pmatrix} 11 & 24 \\ 9 & 6 \end{pmatrix}$",
    "distractors": [
        r"$\begin{pmatrix} 11 & 24 \\ 9 & 8 \end{pmatrix}$",
        r"$\begin{pmatrix} 5 & 8 \\ 9 & 6 \end{pmatrix}$",
        r"$\begin{pmatrix} 11 & 6 \\ 9 & 24 \end{pmatrix}$",
    ],
    "solution_steps": [
        {"title": "Understand the Setup",
         "description": (
             r"Matrix multiplication works by taking each **row of A** and pairing it "
             r"with each **column of B** — multiplying matching entries and summing them. "
             r"The result lives in position $(i, j)$ of the output, produced by row $i$ of "
             r"$A$ and column $j$ of $B$."
             "\n\n"
             r"For two $2 \times 2$ matrices, there are **four entries** to compute:"
             "\n"
             r"$$AB = \begin{pmatrix} A_{\text{row1}} \cdot B_{\text{col1}} & "
             r"A_{\text{row1}} \cdot B_{\text{col2}} \\ A_{\text{row2}} \cdot B_{\text{col1}} & "
             r"A_{\text{row2}} \cdot B_{\text{col2}} \end{pmatrix}$$"
             "\n"
             r"Each \"$\cdot$\" means multiply element-by-element then add — this is called "
             r"the **dot product**.")},
        {"title": "Compute Top-Left Entry",
         "description": (
             r"Entry $(1,1)$: **Row 1 of $A$** $\cdot$ **Column 1 of $B$**"
             "\n"
             r"$$[5 \quad 2] \cdot \begin{bmatrix} 1 \\ 3 \end{bmatrix} = "
             r"(5)(1) + (2)(3) = 5 + 6 = \mathbf{11}$$")},
        {"title": "Compute Top-Right Entry",
         "description": (
             r"Entry $(1,2)$: **Row 1 of $A$** $\cdot$ **Column 2 of $B$**"
             "\n"
             r"$$[5 \quad 2] \cdot \begin{bmatrix} 4 \\ 2 \end{bmatrix} = "
             r"(5)(4) + (2)(2) = 20 + 4 = \mathbf{24}$$")},
        {"title": "Compute Bottom-Left Entry",
         "description": (
             r"Entry $(2,1)$: **Row 2 of $A$** $\cdot$ **Column 1 of $B$**"
             "\n"
             r"$$[0 \quad 3] \cdot \begin{bmatrix} 1 \\ 3 \end{bmatrix} = "
             r"(0)(1) + (3)(3) = 0 + 9 = \mathbf{9}$$")},
        {"title": "Compute Bottom-Right Entry",
         "description": (
             r"Entry $(2,2)$: **Row 2 of $A$** $\cdot$ **Column 2 of $B$**"
             "\n"
             r"$$[0 \quad 3] \cdot \begin{bmatrix} 4 \\ 2 \end{bmatrix} = "
             r"(0)(4) + (3)(2) = 0 + 6 = \mathbf{6}$$")},
        {"title": "Assemble the Result",
         "description": (
             r"Place the four computed entries back into the $2 \times 2$ grid:"
             "\n"
             r"$$AB = \begin{pmatrix} 11 & 24 \\ 9 & 6 \end{pmatrix}$$")},
    ],
}

# 2 ─ Right-triangle trig, WITH the VERIFIED self-checking figure (step1).
#     h = 35·sin48° ≈ 35(0.7431) ≈ 26.0 ft.
RIGHTTRI_SPEC = {
    "type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"],
    "side_labels": {"AB": "35 ft", "BC": "h"},
    "angle_labels": {"A": "48°"},
    "side_lengths": {"AB": 35, "AC": 23.2, "BC": 26.0},
    "right_angle_at": ["C"],
}
RIGHTTRI = {
    "id": RIGHTTRI_ITEM,
    "title": "Right-triangle trig — height from angle and hypotenuse",
    "question": (
        r"A zip-line cable is anchored to the top of a platform and makes a $48°$ angle "
        r"with the level ground. The cable is $35\text{ ft}$ long. To the nearest tenth "
        r"of a foot, how high above the ground is the anchor point at the top of the "
        r"platform?"),
    "final_answer": r"$\text{height} = 35 \times \sin(48°) \approx \boxed{26.0 \text{ ft}}$",
    "distractors": [
        r"$35 \times \cos(48°) \approx 23.4 \text{ ft}$",
        r"$35 \times \tan(48°) \approx 38.9 \text{ ft}$",
        r"$\frac{35}{\sin(48°)} \approx 47.1 \text{ ft}$",
    ],
    "solution_steps": [
        {"title": "Understand the Setup",
         "description": (
             r"A zip-line cable stretches from the top of a platform down to the ground, "
             r"forming a **right triangle**. The cable itself is the **hypotenuse** "
             r"($35\text{ ft}$), the angle between the cable and the ground is $48°$, and "
             r"the platform height is the **side opposite** that angle — which is exactly "
             r"what we want."
             "\n\n"
             r"Whenever you know the hypotenuse and an angle, and you want the **opposite** "
             r"side, the tool is $\sin$:"
             "\n"
             r"$$\sin(\theta) = \frac{\text{opposite}}{\text{hypotenuse}}$$")},
        {"title": "Set Up the Equation",
         "description": (
             r"Plug the known values into the sine ratio, then solve for the height by "
             r"multiplying both sides by $35$:"
             "\n"
             r"$$\sin(48°) = \frac{\text{height}}{35}$$"
             "\n"
             r"$$\text{height} = 35 \times \sin(48°)$$")},
        {"title": "Calculate the Height",
         "description": (
             r"Evaluate using a calculator:"
             "\n"
             r"$$\text{height} = 35 \times \sin(48°) \approx 35 \times 0.7431 \approx "
             r"26.0\text{ ft}$$")},
    ],
}

# 3 ─ Multi-step linear, VERIFIED (step1).  LCD = 12 clears the fractions →
#     5x − 22 = 24 → x = 46/5.  Keep the HONEST fraction.
MULTILIN = {
    "id": MULTILIN_ITEM,
    "title": "Multi-step linear equation — solve for x",
    "question": (
        r"Solve for $x$:"
        "\n"
        r"$$\frac{3(x-2)}{4} - \frac{x+1}{3} = 2.$$"
        "\n"
        r"Show all steps and box your answer."),
    "final_answer": r"$x = \dfrac{46}{5}$",
    "distractors": [r"$x = 10$", r"$x = \frac{34}{5}$", r"$x = 8$"],
    "solution_steps": [
        {"title": "Understand the Problem",
         "description": (
             r"We have one equation with two fractions and need to find $x$. Fractions "
             r"make algebra messy, so the key insight is to **eliminate all denominators "
             r"at once** by multiplying every term by the **Least Common Denominator "
             r"(LCD)**. The denominators are $4$ and $3$, so $\text{LCD} = 12$. This "
             r"instantly clears both fractions and leaves a simple linear equation.")},
        {"title": "Multiply Every Term by 12",
         "description": (
             r"Multiply both sides of the equation by $12$:"
             "\n"
             r"$$12 \cdot \frac{3(x-2)}{4} - 12 \cdot \frac{x+1}{3} = 12 \cdot 2$$"
             "\n"
             r"$12 \div 4 = 3$ and $12 \div 3 = 4$, so the fractions vanish cleanly:"
             "\n"
             r"$$3 \cdot 3(x-2) - 4(x+1) = 24$$"
             "\n"
             r"$$9(x-2) - 4(x+1) = 24$$")},
        {"title": "Distribute & Simplify",
         "description": (
             r"Expand each group by distributing:"
             "\n"
             r"$$9x - 18 - 4x - 4 = 24$$"
             "\n"
             r"Combine the $x$-terms ($9x - 4x$) and the constants ($-18 - 4$):"
             "\n"
             r"$$5x - 22 = 24$$")},
        {"title": "Isolate $x$",
         "description": (
             r"Add $22$ to both sides to move the constant:"
             "\n"
             r"$$5x = 46$$"
             "\n"
             r"Divide both sides by $5$:"
             "\n"
             r"$$x = \frac{46}{5}$$")},
        {"title": "Verify the Solution",
         "description": (
             r"Substitute $x = \frac{46}{5}$ back into the original equation."
             "\n\n"
             r"**Left side:**"
             "\n"
             r"$$\frac{3\!\left(\frac{46}{5}-2\right)}{4} - \frac{\frac{46}{5}+1}{3} = "
             r"\frac{27}{5} - \frac{17}{5} = \frac{10}{5} = 2 \checkmark$$"
             "\n"
             r"Matches the right side, confirming our answer.")},
    ],
}

# ── The WORKSHOP rewrite: "Make this one undefined." (verified step2) ─
# The AI makes B a 3×2 matrix so A(2×2)·B(3×2) is non-conformable — the
# inner dimensions 2 ≠ 3, so AB is undefined. Seeded directly as a PENDING
# proposal on the matrix item's chat (deterministic; no live AI call). The
# updated SOLUTION (the conformability explanation) rides along on the
# proposal so the Workshop modal shows the rewritten answer, not just the
# rewritten question.
WORKSHOP_REQUEST = "Make this one undefined."
WORKSHOP_AI_REPLY = (
    "I've made the product undefined by changing B to a 3×2 matrix — a 2×2 matrix "
    "can't be multiplied by a 3×2 matrix since the inner dimensions don't match "
    "(2 ≠ 3). The solution now explains why the product is undefined."
)
WORKSHOP_AFTER_QUESTION = (
    r"Compute the matrix product $AB$, where"
    "\n"
    r"$$A = \begin{bmatrix} 5 & 2 \\ 0 & 3 \end{bmatrix} \quad \text{and} \quad "
    r"B = \begin{bmatrix} 1 & 4 \\ 3 & 2 \\ 2 & 5 \end{bmatrix}.$$"
    "\n"
    r"Can the product $AB$ be computed? Explain why or why not by checking the "
    r"dimensions of each matrix."
)
WORKSHOP_AFTER_ANSWER = (
    r"The product $AB$ is **undefined** because $A$ is $2 \times 2$ and $B$ is "
    r"$3 \times 2$; the inner dimensions $2 \neq 3$ so the matrices are not "
    r"conformable for multiplication."
)
WORKSHOP_AFTER_STEPS = [
    {"title": "Identify the Dimensions",
     "description": (
         r"First, state the size of each matrix."
         "\n\n"
         r"- Matrix $A$ has **2 rows and 2 columns** → it is a $2 \times 2$ matrix."
         "\n"
         r"- Matrix $B$ has **3 rows and 2 columns** → it is a $3 \times 2$ matrix.")},
    {"title": "Check the Conformability Rule",
     "description": (
         r"For a product $AB$ to exist, the **number of columns in $A$** must equal the "
         r"**number of rows in $B$**."
         "\n"
         r"$$\underbrace{A}_{2 \times \mathbf{2}} \times \underbrace{B}_{\mathbf{3} \times 2}$$"
         "\n"
         r"The inner dimensions are **2 and 3**. Since $2 \neq 3$, the matrices are "
         r"**not conformable** for multiplication.")},
    {"title": "State the Conclusion",
     "description": (
         r"Because the number of columns of $A$ (which is 2) does **not** equal the "
         r"number of rows of $B$ (which is 3), the product $AB$ is **undefined**.")},
]

# ── The MATRIX understanding CATCH (Jordan) — verified step3 ─────────
# Jordan got all four matrix entries RIGHT on paper, but couldn't identify
# which row/column produced any entry, couldn't articulate the dot product
# in his own words, and couldn't predict the direction of change when an
# entry is modified — the signal a grade can't see. His work is correct on
# all three problems → a clean 100%, and the flag sits on that perfect score.
JORDAN_MATRIX_STEPS = [
    {"problem_position": 1, "step_num": 1,
     "latex": r"AB = \begin{pmatrix} 5\cdot1+2\cdot3 & 5\cdot4+2\cdot2 \\ 0\cdot1+3\cdot3 & 0\cdot4+3\cdot2 \end{pmatrix}",
     "plain_english": ""},
    {"problem_position": 1, "step_num": 2,
     "latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 6 \end{pmatrix}", "plain_english": ""},
]
JORDAN_WORK_EXTRACTION = {
    "steps": JORDAN_MATRIX_STEPS,
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 6 \end{pmatrix}",
         "answer_plain": "AB = [[11,24],[9,6]]"},
    ],
    "confidence": 0.94,
}
JORDAN_ALL_STEPS = JORDAN_MATRIX_STEPS + [
    {"problem_position": 2, "step_num": 1, "latex": r"\sin 48° = \frac{h}{35}", "plain_english": ""},
    {"problem_position": 2, "step_num": 2, "latex": r"h = 35\sin 48° \approx 26.0\text{ ft}", "plain_english": ""},
    {"problem_position": 3, "step_num": 1, "latex": r"9(x-2) - 4(x+1) = 24", "plain_english": ""},
    {"problem_position": 3, "step_num": 2, "latex": r"5x - 22 = 24", "plain_english": ""},
    {"problem_position": 3, "step_num": 3, "latex": r"x = \frac{46}{5}", "plain_english": ""},
]
JORDAN_GRADE_EXTRACTION = {
    "steps": JORDAN_ALL_STEPS,
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 6 \end{pmatrix}", "answer_plain": "AB = [[11,24],[9,6]]"},
        {"problem_position": 2, "answer_latex": r"26.0\text{ ft}", "answer_plain": "26.0 ft"},
        {"problem_position": 3, "answer_latex": r"x = \frac{46}{5}", "answer_plain": "x = 46/5"},
    ],
    "confidence": 0.95,
}
JORDAN_FINAL_ANSWERS = {
    MATRIX_ITEM: "AB = [[11,24],[9,6]]",
    RIGHTTRI_ITEM: "26.0 ft",
    MULTILIN_ITEM: "x = 46/5",
}
# Verified transcript (step3-integrity-catch-flag) — agent/student turns only.
JORDAN_TURNS = [
    ("agent",
     "Hey, welcome! I took a look at your work on the matrix multiplication problem — "
     "nice job getting all four entries right.\n\nI want to make sure the method clicked "
     "for you, not just the answer. Let's zoom in on one specific entry you computed.\n\n"
     "Looking at your work, you got **11** as the bottom-left entry of *AB*. Can you walk "
     "me through exactly how you got that number — which row and column did you use, and "
     "what did you actually multiply and add?"),
    ("student",
     "I just multiplied the two matrices together and got that answer. It's right."),
    ("agent",
     "That's a good start — yes, the answer is right! But I want to hear a bit more about "
     "the *how*, since matrix multiplication has a specific process behind it.\n\nFor that "
     "**11** in the bottom-left: which row from matrix *A* and which column from matrix *B* "
     "did you combine to get it? And what were the actual multiplications you did?"),
    ("student",
     "Honestly I don't really remember the exact steps, I just did the multiplication like "
     "we always do."),
    ("agent",
     "Thanks for being upfront about that — I appreciate it! Let me just ask one more "
     "specific thing, and then we'll move on.\n\nThe bottom-left entry of your result is 11. "
     "That entry comes from row 2 of *A* (which is **3, 4**) and column 1 of *B* (which is "
     "**1, 2**). The rule is: multiply the pairs and add them up.\n\nSo the question is: can "
     "you tell me what **3×1 + 4×2** gives you, and does that match what you wrote?"),
    ("student",
     "You kind of multiply the numbers across and add them up... I'm not really sure how to "
     "say it in words."),
    ("agent",
     "That's actually the right idea — \"multiply across and add\" is exactly the dot "
     "product rule! You've got the concept.\n\nLet me ask you one quick conceptual question "
     "to make sure it really clicked:\n\nIf the entry in row 2, column 1 of *B* changed from "
     "**2 to 10**, would your bottom-left answer get bigger or smaller — and why?"),
    ("student",
     "I don't know, I just followed what we did in class. The answer is correct though."),
    ("agent",
     "Fair enough — thanks for engaging with me on this!"),
]
_TEL_AT = "2026-07-02T15:42:00Z"
# Behavior digest → "Tabbed out 2× · Paste 1": paste on his first answer,
# tab-outs on his first two answers (student turns are ordinals 1 and 3).
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
JORDAN_TURN_SECONDS = {1: 40, 3: 18, 5: 22, 7: 15}

# ── Maya's EXONERATION (same matrix, explained in her own words) ─────
# Verified transcript (step3-integrity-exon-pass).
MAYA_TURNS = [
    ("agent",
     "Hey, welcome! I took a look at your work on the matrix multiplication problem — nice "
     "job getting through it. I want to chat briefly about how you approached it.\n\nI can "
     "see you set up the product AB and got your final matrix. Let's dig into one specific "
     "entry: the **top-right entry, which you wrote as 24**. Can you walk me through exactly "
     "how you computed that one — which numbers you multiplied and added together?"),
    ("student",
     "Each entry (i, j) of AB is row i of A dotted with column j of B. Take whichever entry "
     "you like: the bottom-left 9 is row 2 of A, [0, 3], with column 1 of B, [1, 3], so 0 "
     "times 1 plus 3 times 3 = 0 + 9 = 9. The top-right 24 is row 1 of A, [5, 2], with "
     "column 2 of B, [4, 2], so 5 times 4 plus 2 times 2 = 20 + 4 = 24."),
    ("agent",
     "That's a clean explanation — you clearly know the row-dot-column rule and applied it "
     "correctly to specific entries with the right numbers. Nice.\n\nQuick conceptual "
     "question before we wrap up: if you swapped the order and computed **BA instead of AB**, "
     "would you expect to get the same matrix or a different one — and why?"),
    ("student",
     "Order matters: AB is generally NOT equal to BA, because when you flip the order you "
     "pair different rows with different columns, so the entries come out different — matrix "
     "multiplication is not commutative. And the entries respond predictably to the inputs: "
     "since each entry is a sum of products, increasing any entry of B makes the result "
     "entries that use it larger."),
    ("agent",
     "That's a solid answer — you nailed the non-commutativity point with a clear causal "
     "reason (different rows paired with different columns), and the second observation "
     "about monotonicity shows you're thinking about the structure, not just the procedure."),
]
MAYA_MATRIX_STEPS = [  # her correct matrix work (probed problem, position 1)
    {"problem_position": 1, "step_num": 1,
     "latex": r"AB = \begin{pmatrix} 5\cdot1+2\cdot3 & 5\cdot4+2\cdot2 \\ 0\cdot1+3\cdot3 & 0\cdot4+3\cdot2 \end{pmatrix}",
     "plain_english": ""},
    {"problem_position": 1, "step_num": 2,
     "latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 5 \end{pmatrix}", "plain_english": ""},
]
MAYA_MATRIX_EXTRACTION = {
    "steps": MAYA_MATRIX_STEPS,
    "final_answers": [
        {"problem_position": 1, "answer_latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 5 \end{pmatrix}",
         "answer_plain": "AB = [[11,24],[9,5]]"},
    ],
    "confidence": 0.92,
}

# ── Maya's GRADE (verified step4): one honest matrix slip ────────────
# Matrix correct approach, but AB₂₂: 3×2 written as 5 instead of 6 → Partial
# 95% itemized. Triangle + linear Full. (matrix-mult grades correctly — no
# fallback needed; this is the real grader's verified output.)
MAYA_ALL_STEPS = MAYA_MATRIX_STEPS + [
    {"problem_position": 2, "step_num": 1, "latex": r"\sin 48° = \frac{h}{35}", "plain_english": ""},
    {"problem_position": 2, "step_num": 2, "latex": r"h = 35\sin 48° \approx 26.0\text{ ft}", "plain_english": ""},
    {"problem_position": 3, "step_num": 1, "latex": r"9(x-2) - 4(x+1) = 24", "plain_english": ""},
    {"problem_position": 3, "step_num": 2, "latex": r"5x - 22 = 24", "plain_english": ""},
    {"problem_position": 3, "step_num": 3, "latex": r"x = \frac{46}{5}", "plain_english": ""},
]
MAYA_FINAL_ANSWERS = {
    MATRIX_ITEM: "AB = [[11,24],[9,5]]",
    RIGHTTRI_ITEM: "26.0 ft",
    MULTILIN_ITEM: "x = 46/5",
}
MAYA_MATRIX_DEDUCTIONS = [
    {"points_off": 5,
     "reason": "Partial credit: small execution error — arithmetic slip in AB₂₂ (3×2 written as 5 instead of 6)",
     "step_ref": 4},
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
    ("Multiplying matrices (row × column)",          ["x", "r", "x", "r", "r", "f", "f", "r"]),  # 6/8
    ("Right-triangle trigonometry (SOH-CAH-TOA)",    ["r", "r", "x", "r", "r", "f", "f", "f"]),  # 5/8
    ("Setting up a trig ratio from a word problem",  ["x", "r", "r", "r", "f", "f", "-", "f"]),  # 4/7
    ("Multi-step equations with fractions",          ["r", "f", "x", "f", "f", "f", "f", "f"]),  # 2/8
    ("Clearing denominators with the LCD",           ["r", "f", "f", "f", "f", "f", "f", "f"]),  # 1/8
]
_OUTCOME = {"f": "first_try", "r": "retry", "x": "revealed"}

# ── The re-teach set: clean MCQs on the top struggle (matrix mult) ──
RETEACH_TITLE = "Re-teach: Multiplying matrices (row × column)"
PRACTICE_PROBLEMS = [
    {
        "title": "Is the product defined?",
        "question": (
            r"Matrix $A$ is $2 \times 2$ and matrix $B$ is $3 \times 2$. Can the product "
            r"$AB$ be computed?"),
        "final_answer": r"No — the product is undefined (inner dimensions $2 \neq 3$)",
        "distractors": [
            r"Yes — the result is $2 \times 2$",
            r"Yes — the result is $3 \times 3$",
            r"Yes — the result is $2 \times 3$",
        ],
        "solution_steps": [
            {"title": "Line up the inner dimensions",
             "description": r"For $AB$ to exist, the columns of $A$ must equal the rows of $B$: $A$ is $2\times\mathbf{2}$, $B$ is $\mathbf{3}\times2$."},
            {"title": "Compare",
             "description": r"The inner dimensions are $2$ and $3$. Since $2 \neq 3$, the matrices are **not conformable**."},
            {"title": "Conclusion",
             "description": r"The product $AB$ is **undefined**."},
        ],
    },
    {
        "title": "Size of the product",
        "question": r"Matrix $A$ is $2 \times 3$ and matrix $B$ is $3 \times 4$. What is the size of $AB$?",
        "final_answer": r"$2 \times 4$",
        "distractors": [r"$3 \times 3$", r"$3 \times 4$", r"$2 \times 3$"],
        "solution_steps": [
            {"title": "Check conformability",
             "description": r"Columns of $A$ ($3$) equal rows of $B$ ($3$) — the product exists."},
            {"title": "Take the outer dimensions",
             "description": r"$AB$ has the rows of $A$ and the columns of $B$: $\underbrace{A}_{\mathbf{2}\times3}\,\underbrace{B}_{3\times\mathbf{4}}$."},
            {"title": "Answer",
             "description": r"The product $AB$ is $2 \times 4$."},
        ],
    },
    {
        "title": "Compute one entry",
        "question": (
            r"For $A = \begin{pmatrix} 2 & 1 \\ 0 & 3 \end{pmatrix}$ and "
            r"$B = \begin{pmatrix} 4 & 5 \\ 1 & 2 \end{pmatrix}$, what is the top-left "
            r"entry of $AB$?"),
        "final_answer": r"$9$",
        "distractors": [r"$8$", r"$13$", r"$6$"],
        "solution_steps": [
            {"title": "Row 1 of A, column 1 of B",
             "description": r"Take row $1$ of $A$, $[2\ 1]$, with column $1$ of $B$, $[4\ 1]$."},
            {"title": "Dot product",
             "description": r"$(2)(4) + (1)(1) = 8 + 1 = 9.$"},
            {"title": "Answer",
             "description": r"The top-left entry of $AB$ is $9$."},
        ],
    },
]


# ── Handwritten-work photo for the pinned review rail ────────────────
# The teacher review page pins each submission's uploaded photo. We render
# each student's ACTUAL work as a lined-paper "photo" so the pinned rail
# agrees with the extraction, the chat, and the flag. Jordan → all three
# correct (the perfect score behind the flag). Maya → the matrix with her
# honest AB₂₂ slip (5 not 6) + the zip-line 26.0 ft + the multi-step 46/5.
def _handwriting_svg(lines: list[str]) -> str:
    """A lined-notebook 'handwritten' page from a list of work lines."""
    rows = []
    y = 96
    for ln in lines:
        indent = ln.startswith("   ")
        color = "#15643f" if ("=" in ln and ("46/5" in ln or "26.0" in ln
                              or "AB =" in ln)) else "#1c2a52"
        rows.append(
            f'<text x="{92 if indent else 64}" y="{y}" '
            f'font-family="Bradley Hand, Comic Sans MS, Caveat, cursive" '
            f'font-size="30" fill="{color}">{ln.strip()}</text>')
        y += 62
    height = y + 30
    grid = "".join(
        f'<line x1="0" y1="{ly}" x2="720" y2="{ly}" stroke="#cfe0ee" stroke-width="1"/>'
        for ly in range(60, height, 62))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="{height}" '
        f'viewBox="0 0 720 {height}">'
        f'<rect width="720" height="{height}" fill="#fdfcf7"/>'
        f'{grid}'
        f'<line x1="48" y1="0" x2="48" y2="{height}" stroke="#e6a89c" stroke-width="2"/>'
        f'<text x="560" y="34" font-family="Inter, sans-serif" font-size="13" '
        f'fill="#9aa0a6" letter-spacing="1">UNIT 5 · PERIOD 3</text>'
        f'{"".join(rows)}</svg>')


def _svg_file(svg: str) -> dict[str, str]:
    return {"data": base64.b64encode(svg.encode()).decode(), "media_type": "image/svg+xml"}


# Jordan's work photo — all three correct (the perfect score the cold open
# promises), led by the matrix product he can't explain.
JORDAN_WORK_LINES = [
    "1)  A = [ 5  2 ; 0  3 ] ,   B = [ 1  4 ; 3  2 ]",
    "   AB = [ 5·1+2·3   5·4+2·2 ; 0·1+3·3   0·4+3·2 ]",
    "   AB = [ 11  24 ; 9  6 ]",
    "2)  sin 48° = h / 35",
    "   h = 35 · sin 48° ≈ 26.0 ft",
    "3)  3(x−2)/4 − (x+1)/3 = 2",
    "   9(x−2) − 4(x+1) = 24   →   x = 46/5",
]
# Maya's work photo — matrix with her honest AB₂₂ slip (3×2 as 5, not 6),
# the zip-line 26.0 ft, and the multi-step 46/5. Matches her grade.
MAYA_WORK_LINES = [
    "1)  A = [ 5  2 ; 0  3 ] ,   B = [ 1  4 ; 3  2 ]",
    "   AB = [ 11  24 ; 9  5 ]     (3·2 = 5)",
    "2)  sin 48° = h / 35",
    "   h = 35 · sin 48° ≈ 26.0 ft",
    "3)  3(x−2)/4 − (x+1)/3 = 2",
    "   9(x−2) − 4(x+1) = 24   →   x = 46/5",
]


def _new_item(spec: dict, *, figure_spec=None, figure_svg=None) -> QuestionBankItem:
    return QuestionBankItem(
        id=uuid.UUID(spec["id"]),
        course_id=uuid.UUID(COURSE), unit_id=uuid.UUID(UNIT),
        originating_assignment_id=uuid.UUID(UNIT5),
        title=spec["title"], question=spec["question"],
        final_answer=spec["final_answer"], solution_steps=spec["solution_steps"],
        distractors=spec.get("distractors"),
        difficulty="medium", format="frq", status="approved",
        figure_spec=figure_spec, figure_svg=figure_svg,
    )


def _workshop_chat() -> list[dict]:
    """The pre-warmed AI Workshop proposal: 'Make this one undefined.' →
    B becomes 3×2 (non-conformable), question + updated solution rewritten.
    Seeded directly so the Workshop scene lands instantly with no live call."""
    ts = "2026-07-02T15:40:00+00:00"
    return [
        {"role": "teacher", "text": WORKSHOP_REQUEST, "ts": ts},
        {"role": "ai", "text": WORKSHOP_AI_REPLY, "ts": ts,
         "proposal": {
             "question": WORKSHOP_AFTER_QUESTION,
             "solution_steps": WORKSHOP_AFTER_STEPS,
             "final_answer": WORKSHOP_AFTER_ANSWER,
             "figure_spec": None, "figure_svg": None,
         }},
    ]


async def main() -> None:
    async with get_session_factory()() as s:
        now = datetime.now(UTC)

        # 1 ── the class identity: General Math, taught by Ms. Rivera ──
        await s.execute(text("update courses set name='General Math' where id=:c"), {"c": COURSE})
        await s.execute(text("update users set name='Ms. Rivera' where email=:e"), {"e": TEACHER_EMAIL})
        await s.execute(text("update units set name='Unit 5' where id=:u"), {"u": UNIT})
        print("named the class 'General Math', the teacher 'Ms. Rivera', the unit 'Unit 5'")

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
        await s.execute(
            text("update assignments set title='Unit 5 Review', status='published', "
                 "content=:c where id=:a"),
            {"c": json.dumps({"problem_ids": UNIT5_PROBLEMS}), "a": UNIT5})
        await s.execute(text("update assignments set due_at=:d, integrity_check_enabled=true, "
                             "ai_grading_enabled=true where id=:a"),
                        {"d": now + timedelta(days=14), "a": UNIT5})
        print(f"seeded Unit 5 Review with 3 problems (figure svg {len(rt_svg)} chars)")

        # 2b ── the re-teach set: 3 clean MCQs on matrix multiplication
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
            headline="Student understood their own work",
            overall_summary=(
                "Maya explained specific matrix entries using the row-dot-column rule with "
                "precise numbers, articulated why matrix multiplication is non-commutative "
                "with a causal reason, and showed structural understanding of how entries "
                "respond to changes in the inputs — all in her own words."),
            probe_selection_reason="verified_hardest_correct", resolution="unresolved")
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id, bank_item_id=uuid.UUID(MATRIX_ITEM),
            sample_position=0, status="verdict_submitted",
            student_work_extraction=MAYA_MATRIX_EXTRACTION,
            rubric={"paraphrase_originality": "high", "causal_fluency": "high",
                    "transfer": "high"},
            ai_reasoning=(
                "Explained specific entries with correct row-column pairings in her own "
                "words, gave a causal explanation for non-commutativity, and showed "
                "structural understanding — fluent and original."),
            selected_reason="verified_hardest_correct"))
        for i, (role, content) in enumerate(MAYA_TURNS):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=check.id, ordinal=i, role=role,
                content=content, seconds_on_turn=None, telemetry=None))
        print(f"seeded PASS understanding-check ({len(MAYA_TURNS)} turns) on Maya's matrix work")

        # 4 ── Maya's grade: matrix Partial 95%, triangle + linear Full ─
        sub = (await s.execute(select(Submission).where(Submission.id == sub_uuid))).scalar_one()
        sub.extraction = {"steps": MAYA_ALL_STEPS, "final_answers": [
            {"problem_position": 1, "answer_latex": r"AB = \begin{pmatrix} 11 & 24 \\ 9 & 5 \end{pmatrix}", "answer_plain": "AB = [[11,24],[9,5]]"},
            {"problem_position": 2, "answer_latex": r"26.0\text{ ft}", "answer_plain": "26.0 ft"},
            {"problem_position": 3, "answer_latex": r"x = \frac{46}{5}", "answer_plain": "x = 46/5"},
        ], "confidence": 0.9}
        sub.extraction_confirmed_at = sub.extraction_confirmed_at or now
        sub.final_answers = dict(MAYA_FINAL_ANSWERS)
        sub.files = [_svg_file(_handwriting_svg(MAYA_WORK_LINES))]
        flag_modified(sub, "extraction")
        flag_modified(sub, "final_answers")
        flag_modified(sub, "files")

        grade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == sub_uuid))).scalar_one_or_none()
        if grade is None:
            grade = SubmissionGrade(submission_id=sub_uuid)
            s.add(grade)
        # The REAL grader's verified output (step4-grade-partial-slip): matrix
        # Partial 95% for the honest AB₂₂ slip; triangle + linear Full.
        grade.breakdown = [
            {"problem_id": MATRIX_ITEM, "score_status": "partial", "percent": 95.0,
             "confidence": 0.97,
             "feedback": ("Your matrix multiplication set-up is perfect and three of the four "
                          "entries are correct. Double-check AB₂₂: 3 × 2 = 6, not 5, so the "
                          "bottom-right entry should be 6."),
             "deductions": MAYA_MATRIX_DEDUCTIONS, "student_answer": "AB = [[11,24],[9,5]]"},
            {"problem_id": RIGHTTRI_ITEM, "score_status": "full", "percent": 100.0,
             "confidence": 0.99,
             "feedback": ("Great work — you correctly identified the sine relationship, set up "
                          "the equation, and rounded to the right number of decimal places."),
             "deductions": [], "student_answer": "26.0 ft"},
            {"problem_id": MULTILIN_ITEM, "score_status": "full", "percent": 100.0,
             "confidence": 0.95,
             "feedback": ("Excellent — you found the common denominator, simplified the "
                          "numerator correctly, and solved for x without any errors."),
             "deductions": [], "student_answer": "x = 46/5"},
        ]
        grade.ai_breakdown = {"grades": [
            {"problem_position": 1, "student_answer": r"$AB=\begin{pmatrix}11&24\\9&5\end{pmatrix}$",
             "score_status": "partial", "percent": 95.0, "confidence": 0.97,
             "reasoning": ("The student's approach is fully correct and three of four entries "
                           "match the answer key. The only error is an arithmetic slip in "
                           "Step 4: 3×2 was written as 5 instead of 6, giving AB₂₂ = 5 instead "
                           "of 6."),
             "student_feedback": ("Your matrix multiplication set-up is perfect and three of the "
                                  "four entries are correct. Double-check AB₂₂: 3 × 2 = 6, not 5."),
             "deductions": MAYA_MATRIX_DEDUCTIONS},
            {"problem_position": 2, "student_answer": r"$26.0\text{ ft}$",
             "score_status": "full", "percent": 100.0, "confidence": 0.99,
             "reasoning": ("Correct sine ratio (opposite/hypotenuse), set up h = 35 sin 48°, "
                           "evaluated to 25.99, rounded to 26.0 ft — matches the key."),
             "student_feedback": "Great work — correct setup and rounding.", "deductions": []},
            {"problem_position": 3, "student_answer": r"$x=\dfrac{46}{5}$",
             "score_status": "full", "percent": 100.0, "confidence": 0.95,
             "reasoning": ("Combined fractions with a common denominator of 12, simplified to "
                           "5x − 22 = 24, solved to x = 46/5 — matches the key."),
             "student_feedback": "Excellent — clean work, correct answer.", "deductions": []},
        ]}
        grade.final_score = sum(e["percent"] for e in grade.breakdown) / len(grade.breakdown)
        grade.ai_score = grade.final_score
        grade.graded_at = now
        grade.grade_published_at = None
        flag_modified(grade, "breakdown")
        flag_modified(grade, "ai_breakdown")
        print(f"seeded Maya's grade: matrix 95 · triangle 100 · linear 100 → {grade.final_score:.0f}%")

        # 4b ── Jordan's CATCH: right product, can't explain → flagged ─
        jsub_uuid = uuid.UUID(JORDAN_SUB)
        jsub = (await s.execute(select(Submission).where(Submission.id == jsub_uuid))).scalar_one()
        jsub.extraction = JORDAN_GRADE_EXTRACTION
        jsub.extraction_confirmed_at = jsub.extraction_confirmed_at or now
        jsub.final_answers = dict(JORDAN_FINAL_ANSWERS)
        jsub.files = [_svg_file(_handwriting_svg(JORDAN_WORK_LINES))]
        flag_modified(jsub, "extraction")
        flag_modified(jsub, "final_answers")
        flag_modified(jsub, "files")

        jgrade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == jsub_uuid))).scalar_one_or_none()
        if jgrade is None:
            jgrade = SubmissionGrade(submission_id=jsub_uuid)
            s.add(jgrade)
        # The REAL grader's verified output (step4-grade-all-correct): every
        # problem Full·100% — the flagged perfect score the cold open promises.
        jbreak, jai = [], []
        for pos, pid in enumerate(UNIT5_PROBLEMS, start=1):
            ans = JORDAN_FINAL_ANSWERS[pid]
            jbreak.append({"problem_id": pid, "score_status": "full", "percent": 100.0,
                           "confidence": 1.0, "feedback": "Correct — matches the answer key.",
                           "deductions": [], "student_answer": ans})
            jai.append({"problem_position": pos, "student_answer": ans, "score_status": "full",
                        "percent": 100.0, "confidence": 1.0, "reasoning": "Matches the answer key.",
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
            headline="Review — correct work but he couldn't explain it",
            overall_summary=(
                "Jordan got all four matrix entries correct on paper but could not identify "
                "which row/column produced any specific entry, could not articulate the dot "
                "product process in his own words, and could not predict the direction of "
                "change when a single matrix entry was modified — suggesting the work was "
                "not genuinely his own. Worth a quick conversation before this counts."),
            probe_selection_reason="verified_hardest_correct", resolution="unresolved")
        s.add(jcheck)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=jcheck.id, bank_item_id=uuid.UUID(MATRIX_ITEM),
            sample_position=0, status="verdict_submitted",
            student_work_extraction=JORDAN_WORK_EXTRACTION,
            rubric={"paraphrase_originality": "low", "causal_fluency": "low",
                    "transfer": "not_probed", "prediction": "low",
                    "authority_resistance": "not_probed", "self_correction": "not_observed"},
            ai_reasoning=(
                "Got the correct answer but could not articulate the specific steps, couldn't "
                "explain which row/column combination produced any entry, and couldn't answer "
                "a simple directional prediction about what happens when one entry changes — "
                "indicating no genuine understanding of his own work."),
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

        # 5 ── seed the AI Workshop 'undefined' proposal on the matrix
        #       item (pending; the Workshop scene lands it instantly).
        mfig = (await s.execute(select(QuestionBankItem).where(
            QuestionBankItem.id == uuid.UUID(MATRIX_ITEM)))).scalar_one()
        mfig.chat_messages = _workshop_chat()
        flag_modified(mfig, "chat_messages")
        print("seeded pending AI Workshop proposal ('Make this one undefined.') on the matrix")

        await s.commit()
    print("prep complete")


if __name__ == "__main__":
    asyncio.run(main())
