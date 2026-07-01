"""Data prep for the Veradic teacher<->student cycle demo recording.

Idempotent. Curates the seeded "Algebra I · Period 3" world so every screen
reads clean on camera:

  1. Rename the eight "Student A..H" placeholders to realistic names that
     match the practice-insight statuses (strugglers / thriving / on-track).
  2. Approve three freshly-generated Geometry problems (one with a
     self-verified figure) and pin them to the "Triangles & Angles"
     assignment so the generation scene lands on a clean 3.
  3. Seed an in-progress AI "understanding check" on Maya Chen's Period 3
     Linear Equations submission so the student route renders the
     multi-turn probe chat (completed checks route away from the chat UI).

Run:  PYTHONPATH=. .venv/bin/python -m scripts.cycle_video_prep
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, text

from sqlalchemy.orm.attributes import flag_modified

from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.practice_activity import PracticeActivity
from api.models.question_bank import QuestionBankItem

# ── Known seed IDs (Algebra I · Period 3) ────────────────────────────
GEO_ASSIGNMENT = "75375c6c-7e39-44a2-842e-f7b4f72ecd71"  # Triangles & Angles
GEO_KEEP = [  # order = on-camera order; the middle one carries the figure
    "c3acd48e-e3ec-4c13-a8fa-c60e7df22041",  # Missing angle in a triangle
    "44e22fa0-bafb-4f01-bb4c-514e8a93228d",  # Right triangle — find side (FIGURE)
    "70eaac56-12da-4771-9094-d1cfd5b5077b",  # Triangle angle sum with algebra
]
GEO_REJECT = "aa4b63dd-2767-4b62-b302-9edf046f71e2"  # exterior angle (ugly ans)

MAYA_LIN_SUB = "34f22f8f-42fc-401e-a9d5-bb3d54bbd86d"  # Period 3 Maya's sub
MAYA_Q3_BANK = "f447f2b0-9a2c-4ab9-aac2-d9083c40d828"  # 2(x-3)=4x+8

# ── The integrity CATCH (Jordan Blake) ───────────────────────────────
# A student who got a problem RIGHT — correct final answer AND clean
# written steps — but can't explain WHY any step works or adapt to a
# tweak. That's the signal a grade can never see: a right answer that
# isn't real understanding. We author it as a COMPLETE flag_for_review
# check so the teacher review renders a resolved red verdict (not a
# loading state) and the student route plays the warm chat + terminal.
JORDAN_LIN_SUB = "729a070d-4250-497c-bdc7-887e3280fa29"  # Jordan's Period 3 sub
LIN_P4_BANK = "9d78f5ab-7de0-428d-8cb3-9a73bcb0d51e"  # 5x - 7 = 3x + 2  (x = 4.5)
LIN_PROBLEM_IDS = [  # the four LIN problems, in on-HW order (positions 1-4)
    "729dbc13-354d-4bb3-9e19-c9aea884844a",  # 2x + 3 = 11      → x = 4
    "b162bbe1-43f8-45cb-ac21-652cb3f0a60e",  # 3(x - 4) + 5     → 3x - 7
    "f447f2b0-9a2c-4ab9-aac2-d9083c40d828",  # 3(x - 2) = 2x+9  → x = 15
    "9d78f5ab-7de0-428d-8cb3-9a73bcb0d51e",  # 5x - 7 = 3x + 2  → x = 4.5
]
# Jordan's correct, fully-worked steps on problem 4 (verified below).
# 5x - 7 = 3x + 2  → (−3x)  2x - 7 = 2  → (+7)  2x = 9  → (÷2)  x = 4.5
JORDAN_P4_STEPS = [
    {"problem_position": 4, "step_num": 1, "latex": "5x - 7 = 3x + 2", "plain_english": ""},
    {"problem_position": 4, "step_num": 2, "latex": "2x - 7 = 2", "plain_english": ""},
    {"problem_position": 4, "step_num": 3, "latex": "2x = 9", "plain_english": ""},
    {"problem_position": 4, "step_num": 4, "latex": "x = 4.5", "plain_english": ""},
]
JORDAN_WORK_EXTRACTION = {
    "steps": JORDAN_P4_STEPS,
    "final_answers": [
        {"problem_position": 4, "answer_latex": "x = 4.5", "answer_plain": "x = 4.5"},
    ],
    "confidence": 0.94,
}
# Jordan's correct final answers across all four problems (so the grade
# reads a clean 100% and the flag lands on a perfect score — the whole
# point: the grade can't tell him apart from a student who understands).
JORDAN_FINAL_ANSWERS = {
    LIN_PROBLEM_IDS[0]: "x = 4",
    LIN_PROBLEM_IDS[1]: "3x - 7",
    LIN_PROBLEM_IDS[2]: "x = 15",
    LIN_PROBLEM_IDS[3]: "x = 4.5",
}
# The catch transcript. The AI stays warm the whole way and never
# accuses — it just probes, hears hollow answers, and privately flags
# it for the teacher. Reveals turn-by-turn on camera.
JORDAN_TURNS = [
    ("agent",
     "Hi Jordan — thanks for turning that in! Your answer to problem 4, "
     "$x = 4.5$, is exactly right. I just want to hear your thinking. You "
     "started with $5x - 7 = 3x + 2$ — what was your very first step?"),
    ("student",
     "I moved everything around to get x by itself. The answer's 4.5."),
    ("agent",
     "Right idea. Let's slow down on one move: how did you get from "
     "$5x - 7 = 3x + 2$ to $2x - 7 = 2$? What happened to the $3x$?"),
    ("student",
     "I'm not really sure why, that's just how it goes. I knew it came out "
     "to 4.5."),
    ("agent",
     "No worries — one more and we're done. If the problem were "
     "$6x - 7 = 3x + 2$ instead, what would your first step be?"),
    ("student",
     "I don't know. I just remembered the steps for this one."),
    ("agent",
     "Thanks, Jordan — that's really helpful, exactly what I needed. "
     "We're all set here!"),
]

ALG_COURSE = "c99b654b-7ef8-4b05-a1df-a57c47d98f6e"
SECTION = "845950c6-dc06-40a7-ba72-278ae63c221c"       # Period 3
ALG_UNIT = "5547f6d5-0487-4174-bae0-a25908900c68"      # Linear Equations
RETEACH_ASSIGNMENT = "8a852631-d500-4574-be94-536ea99f4f5a"  # draft practice
PRACTICE_ASSIGNMENT = "f1b8b77e-706b-4d07-97fe-c808a8548ccf"  # published practice
RETEACH_TITLE = "Re-teach: Distributing a negative across parentheses"

# Clean MCQ practice problems (answer + distractors + worked steps) on the
# weakest concept, so scene 6's re-teach result and scene 7's student
# practice + learn both render real, legible content.
PRACTICE_PROBLEMS = [
    {
        "title": "Distribute a negative", "question": r"Simplify:  $-(3x - 5)$",
        "final_answer": r"$-3x + 5$",
        "distractors": [r"$-3x - 5$", r"$3x - 5$", r"$-3x - 15$"],
        "solution_steps": [
            {"title": "A negative sign means times -1",
             "description": r"A minus sign in front of parentheses multiplies **every** term inside by $-1$:  $-(3x-5) = (-1)(3x) + (-1)(-5)$."},
            {"title": "Flip each sign",
             "description": r"$(-1)(3x) = -3x$ and $(-1)(-5) = +5$ — the $-5$ becomes $+5$."},
            {"title": "Write the result",
             "description": r"$-(3x-5) = -3x + 5$.  Both signs inside flipped."},
        ],
    },
    {
        "title": "Subtract a group", "question": r"Simplify:  $8 - (2x + 6)$",
        "final_answer": r"$2 - 2x$",
        "distractors": [r"$2 + 2x$", r"$14 - 2x$", r"$-2x - 2$"],
        "solution_steps": [
            {"title": "Distribute the minus",
             "description": r"Subtracting the group flips both signs inside:  $-(2x+6) = -2x - 6$."},
            {"title": "Rewrite the expression",
             "description": r"$8 - (2x+6) = 8 - 2x - 6$."},
            {"title": "Combine the numbers",
             "description": r"$8 - 6 = 2$, so the answer is $2 - 2x$."},
        ],
    },
    {
        "title": "Negative coefficient", "question": r"Simplify:  $-2(4 - x)$",
        "final_answer": r"$2x - 8$",
        "distractors": [r"$-2x - 8$", r"$-8 - 2x$", r"$2x + 8$"],
        "solution_steps": [
            {"title": "Multiply each term by -2",
             "description": r"$-2(4 - x) = (-2)(4) + (-2)(-x)$."},
            {"title": "Watch the second sign",
             "description": r"$(-2)(4) = -8$ and $(-2)(-x) = +2x$ — two negatives make a positive."},
            {"title": "Write it answer-first",
             "description": r"$-8 + 2x = 2x - 8$."},
        ],
    },
]

# Student A..H email-prefix -> realistic name, ordered to match status:
# A-E struggling, F-G thriving, H on_track (see student-insights probe).
RENAMES = {
    "student_66a7": "Liam Walsh",     # A struggling
    "student_7093": "Sofia Reyes",    # B struggling
    "student_4f62": "Daniel Brooks",  # C struggling
    "student_826b": "Priya Nair",     # D struggling
    "student_56d1": "Marcus Lee",     # E struggling
    "student_c41a": "Emma Torres",    # F thriving
    "student_bd8f": "Olivia Grant",   # G thriving
    "student_bb09": "Ethan Park",     # H on_track
}

# The curated understanding-check transcript (probe + reasoned answer +
# affirmation), tied to Maya's actual Q3 work and her sign slip — so it
# threads straight into the grading-receipt scene.
TURNS = [
    ("agent",
     "Thanks for turning that in, Maya! Quick check on problem 3 — you had "
     "$3(x-2) = 2x + 9$. Walk me through your very first move and why you "
     "did it."),
    ("student",
     "I distributed the 3 into the parentheses first, so 3(x - 2) becomes "
     "3x - 6. You have to multiply both the x and the -2 by the 3, "
     "otherwise the two sides aren't equal anymore."),
    ("agent",
     "Exactly - distributing across *both* terms is the key idea, and "
     "you said why. Once you had $3x - 6 = 2x + 9$, how did you decide which "
     "terms to move where?"),
    ("student",
     "I wanted the x's on one side and the plain numbers on the other, so I "
     "subtracted 2x from both sides to collect the variables. That's the part "
     "I rushed - I think I slipped a sign when I moved the -6 across."),
    ("agent",
     "That's a really honest read of your own work. Your method is solid "
     "- it was a sign slip on one step, not a misunderstanding. Slowing "
     "down right there next time will lock it in. Thanks for talking it "
     "through!"),
]

# Class struggle picture (scene 5 struggle-list + scene 6 re-teach). Each
# concept -> the students who STRUGGLED (outcome retry/revealed); the rest
# of the 8 active students got it first try. Ordered most-struggled first.
# "f"=first_try "r"=retry(struggled) "x"=revealed(struggled) "-"=didn't do.
ACTIVE = ["Liam Walsh", "Sofia Reyes", "Daniel Brooks", "Priya Nair",
          "Marcus Lee", "Emma Torres", "Olivia Grant", "Ethan Park"]
STRUGGLE_CONCEPTS = [
    # title,                                          per-student outcomes (len 8)
    ("Distributing a negative across parentheses",   ["x", "r", "x", "r", "r", "f", "f", "r"]),  # 6/8
    ("Variables on both sides of the equation",      ["r", "r", "x", "r", "r", "f", "f", "f"]),  # 5/8
    ("Translating word problems into equations",     ["x", "r", "r", "r", "f", "f", "-", "f"]),  # 4/7
    ("Multi-step equations with fractions",          ["r", "f", "x", "f", "f", "f", "f", "f"]),  # 2/8
    ("Combining like terms",                         ["r", "f", "f", "f", "f", "f", "f", "f"]),  # 1/8
]
_OUTCOME = {"f": "first_try", "r": "retry", "x": "revealed"}

# Maya's problem-3 work, shown verbatim on the grading receipt AND used
# as the understanding-check work extraction. The visible steps carry the
# two real errors the receipt names:
#   step 3  `3x - 2x = 9 - 6`  → SIGN error (should be 9 + 6)   → -20%
#   step 4  `x = 4`            → ARITHMETIC (9 - 6 = 3, not 4)  → -7%
# Correct answer is x = 15; her final answer is x = 4 → 73%.
MAYA_Q3_STEPS = [
    {"problem_position": 3, "step_num": 1, "latex": "3(x - 2) = 2x + 9", "plain_english": ""},
    {"problem_position": 3, "step_num": 2, "latex": "3x - 6 = 2x + 9", "plain_english": ""},
    {"problem_position": 3, "step_num": 3, "latex": "3x - 2x = 9 - 6", "plain_english": ""},
    {"problem_position": 3, "step_num": 4, "latex": "x = 4", "plain_english": ""},
]
MAYA_Q3_DEDUCTIONS = [
    {"points_off": 20, "reason": "Sign error moving -6 across", "step_ref": 3},
    {"points_off": 7, "reason": "Arithmetic: 9 - 6 = 3, not 4", "step_ref": 4},
]
MAYA_WORK_EXTRACTION = {
    "steps": MAYA_Q3_STEPS,
    "final_answers": [
        {"problem_position": 3, "answer_latex": "x = 4", "answer_plain": "x = 4"},
    ],
    "confidence": 0.9,
}


async def main() -> None:
    async with get_session_factory()() as s:
        # 1 ── rename placeholder students ───────────────────────────
        renamed = 0
        for prefix, name in RENAMES.items():
            res = await s.execute(
                text("update users set name=:n where email like :e"),
                {"n": name, "e": f"{prefix}@%"},
            )
            renamed += res.rowcount or 0
        print(f"renamed {renamed} students")

        # 1b ── suppress first-run onboarding tours for the two actors ─
        await s.execute(text(
            "update users set tours_seen = '[\"student\",\"teacher\",\"personal\"]'::jsonb "
            "where email in ('td_teacher_d592cc@t.com','maya_d52a@school.edu',"
            "'jordan_a395@school.edu')"))
        print("marked onboarding tours seen for teacher + Maya + Jordan")

        # 1c ── stamp the section's students with the course's school so
        #        the SPA recognises them as school students (the seed left
        #        school_id null, which bounces them to the personal /home).
        await s.execute(text(
            "update users set school_id = ("
            "  select c.school_id from courses c"
            "  where c.id='c99b654b-7ef8-4b05-a1df-a57c47d98f6e')"
            " where id in ("
            "  select se.student_id from section_enrollments se"
            "  where se.section_id='845950c6-dc06-40a7-ba72-278ae63c221c')"))
        print("stamped Period 3 students with the course school")

        # 2 ── approve the 3 geometry problems, reject the 4th ───────
        await s.execute(
            text("update question_bank_items set status='approved' "
                 "where id = any(:ids)"),
            {"ids": GEO_KEEP},
        )
        await s.execute(
            text("update question_bank_items set status='rejected' where id=:i"),
            {"i": GEO_REJECT},
        )
        await s.execute(
            text("update assignments set content=:c where id=:a"),
            {"c": json.dumps({"problem_ids": GEO_KEEP}), "a": GEO_ASSIGNMENT},
        )
        print(f"approved {len(GEO_KEEP)} geometry problems (1 with figure)")

        # 2b ── seed a clean MCQ + worked-steps practice set on the
        #        weakest concept. The student practice runner sources
        #        problems by originating_assignment_id; the teacher
        #        detail page sources by content — so we set both on the
        #        one published practice set, used by scenes 6 AND 7.
        await s.execute(text(
            "delete from question_bank_items where originating_assignment_id=:a"),
            {"a": PRACTICE_ASSIGNMENT})  # clear the FRQ stubs
        new_ids: list[str] = []
        for spec in PRACTICE_PROBLEMS:
            item = QuestionBankItem(
                course_id=uuid.UUID(ALG_COURSE), unit_id=uuid.UUID(ALG_UNIT),
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
        print(f"seeded {len(new_ids)} MCQ practice problems on the re-teach set")

        # 2c ── rebuild the class struggle picture (concept bank items +
        #        practice activity) that scene 5/6 read. The reseed above
        #        cleared the original concept items + their activity, so
        #        we author a clean, controlled distribution here.
        # Resolve by section enrollment — same names exist in other seeds,
        # so a bare name lookup grabs the wrong student.
        sid_by_name = {}
        for name in ACTIVE:
            sid = (await s.execute(text(
                "select u.id from users u join section_enrollments se "
                "on se.student_id=u.id where se.section_id=:s and u.name=:n"),
                {"s": SECTION, "n": name})).scalar()
            sid_by_name[name] = sid
        # concept holder items live on the (unused) re-teach assignment so
        # they never render as practice problems on the published set.
        await s.execute(text(
            "delete from practice_activity where section_id=:s"), {"s": SECTION})
        await s.execute(text(
            "delete from question_bank_items where originating_assignment_id=:a "
            "and title = any(:t)"),
            {"a": RETEACH_ASSIGNMENT, "t": [c for c, _ in STRUGGLE_CONCEPTS]})
        now = datetime.now(UTC)
        acts = 0
        for ci, (title, outcomes) in enumerate(STRUGGLE_CONCEPTS):
            concept = QuestionBankItem(
                course_id=uuid.UUID(ALG_COURSE), unit_id=uuid.UUID(ALG_UNIT),
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
                    student_id=sid_by_name[ACTIVE[si]],
                    section_id=uuid.UUID(SECTION),
                    practice_assignment_id=uuid.UUID(PRACTICE_ASSIGNMENT),
                    bank_item_id=concept.id, mode="practice",
                    outcome=_OUTCOME[code],
                    created_at=now - timedelta(days=ci % 3, hours=si),
                ))
                acts += 1
        print(f"rebuilt struggle picture: {len(STRUGGLE_CONCEPTS)} concepts, {acts} activities")

        # 3 ── seed Maya's COMPLETED understanding check + verdict ────
        # Seeded `complete` + `pass` (not `in_progress`): the student
        # scene plays the flowing chat AND lands on the completion
        # verdict, and the teacher review shows a RESOLVED green verdict
        # ("Student understood their own work") instead of a perpetual
        # "Integrity check running" placeholder. The student page routes
        # a completed check back into the chat (see the routing fix in
        # school/student/.../homework/[assignmentId]/page.tsx).
        teacher_id = (await s.execute(text(
            "select id from users where email='td_teacher_d592cc@t.com'"))).scalar()
        sub_uuid = uuid.UUID(MAYA_LIN_SUB)
        existing = (await s.execute(
            select(IntegrityCheckSubmission.id)
            .where(IntegrityCheckSubmission.submission_id == sub_uuid)
        )).scalars().all()
        for cid in existing:
            await s.execute(delete(IntegrityConversationTurn).where(
                IntegrityConversationTurn.integrity_check_submission_id == cid))
            await s.execute(delete(IntegrityCheckProblem).where(
                IntegrityCheckProblem.integrity_check_submission_id == cid))
        await s.execute(delete(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == sub_uuid))

        check = IntegrityCheckSubmission(
            submission_id=sub_uuid,
            status="complete",
            disposition="pass",
            headline="Explained her method in her own words",
            overall_summary=(
                "Maya walked through distributing 3 across (x − 2) and "
                "collecting like terms in her own words, and caught that "
                "her only slip was a sign error — not a misunderstanding."),
            probe_selection_reason="verified_hardest_correct",
            resolution="unresolved",
        )
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id,
            bank_item_id=uuid.UUID(MAYA_Q3_BANK),
            sample_position=0,
            status="verdict_submitted",
            student_work_extraction=MAYA_WORK_EXTRACTION,
            rubric={"paraphrase_originality": "high", "causal_fluency": "high"},
            ai_reasoning=(
                "Explained distributing across both terms and why, then "
                "identified her own sign slip — clear ownership of the method."),
            selected_reason="verified_hardest_correct",
        ))
        for i, (role, content) in enumerate(TURNS):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=check.id,
                ordinal=i, role=role, content=content,
                seconds_on_turn=None, telemetry=None,
            ))
        print(f"seeded COMPLETE understanding-check + pass verdict "
              f"({len(TURNS)} turns) on Maya's Linear Equations submission")

        # 4 ── the grading receipt: problem 3 = 3(x-2)=2x+9 @ 73% ─────
        # Answer key + student's shown work + the itemized receipt whose
        # two named errors line up with the two visible bad steps.
        q3 = (await s.execute(select(QuestionBankItem).where(
            QuestionBankItem.id == uuid.UUID(MAYA_Q3_BANK)))).scalar_one()
        q3.question = r"Solve for x:  $3(x - 2) = 2x + 9$"
        q3.final_answer = r"$x = 15$"

        sub = (await s.execute(select(Submission).where(
            Submission.id == sub_uuid))).scalar_one()
        ext = dict(sub.extraction or {})
        ext["steps"] = ([st for st in ext.get("steps", [])
                         if st.get("problem_position") != 3] + MAYA_Q3_STEPS)
        ext["final_answers"] = ([fa for fa in ext.get("final_answers", [])
                                 if fa.get("problem_position") != 3]
                                + [{"problem_position": 3, "answer_latex": "x = 4",
                                    "answer_plain": "x = 4"}])
        sub.extraction = ext
        sub.extraction_confirmed_at = sub.extraction_confirmed_at or now
        fa = dict(sub.final_answers or {})
        fa[MAYA_Q3_BANK] = "x = 4"
        sub.final_answers = fa
        flag_modified(sub, "extraction")
        flag_modified(sub, "final_answers")

        grade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == sub_uuid))).scalar_one_or_none()
        if grade is None:
            grade = SubmissionGrade(submission_id=sub_uuid)
            s.add(grade)
        entry = {
            "problem_id": MAYA_Q3_BANK, "score_status": "partial",
            "percent": 73.0, "confidence": 0.9,
            "feedback": ("Right approach and clean setup — but when you moved "
                         "the -6 across the equals sign it should become +6 "
                         "(step 3), and 9 - 6 is 3, not 4 (step 4)."),
            "deductions": MAYA_Q3_DEDUCTIONS, "student_answer": "x = 4",
        }
        grade.breakdown = ([e for e in (grade.breakdown or [])
                            if e.get("problem_id") != MAYA_Q3_BANK] + [entry])
        ai = dict(grade.ai_breakdown or {})
        ai_grade = {
            "problem_position": 3, "student_answer": "x = 4",
            "score_status": "partial", "percent": 73.0, "confidence": 0.9,
            "reasoning": ("Setup and method are correct; sign error moving -6 "
                          "across in step 3, and an arithmetic slip (9 - 6 = 3, "
                          "not 4) in step 4."),
            "student_feedback": ("Right approach — flip the sign of the -6 when "
                                 "it crosses the equals sign (step 3), and "
                                 "recheck 9 - 6 in step 4."),
            "deductions": MAYA_Q3_DEDUCTIONS,
        }
        ai["grades"] = ([g for g in ai.get("grades", [])
                         if g.get("problem_position") != 3] + [ai_grade])
        grade.ai_breakdown = ai
        grade.final_score = sum(e["percent"] for e in grade.breakdown) / len(grade.breakdown)
        grade.ai_score = grade.final_score
        grade.graded_at = now
        grade.grade_published_at = None
        flag_modified(grade, "breakdown")
        flag_modified(grade, "ai_breakdown")
        print(f"seeded 73% receipt on problem 3 (class avg {grade.final_score:.0f}%)")

        # 4b ── the integrity CATCH: Jordan's right-but-can't-explain ──
        # Correct work + correct final answers + a COMPLETE
        # flag_for_review verdict, so the student route plays the warm
        # turn-by-turn chat and the teacher review lands on a resolved
        # red flag banner (not a loading state).
        jordan_sub_uuid = uuid.UUID(JORDAN_LIN_SUB)
        jsub = (await s.execute(select(Submission).where(
            Submission.id == jordan_sub_uuid))).scalar_one()
        # Clean, correct P4 work (verified: 5x-7=3x+2 → x=4.5).
        jext = dict(jsub.extraction or {})
        jext["steps"] = ([st for st in jext.get("steps", [])
                          if st.get("problem_position") != 4] + JORDAN_P4_STEPS)
        jext["final_answers"] = [
            {"problem_position": 4, "answer_latex": "x = 4.5", "answer_plain": "x = 4.5"},
        ]
        jsub.extraction = jext
        jsub.extraction_confirmed_at = jsub.extraction_confirmed_at or now
        jsub.final_answers = dict(JORDAN_FINAL_ANSWERS)
        flag_modified(jsub, "extraction")
        flag_modified(jsub, "final_answers")

        # A clean 100% grade — every answer correct. The flag sits on a
        # perfect score, which is exactly the point.
        jgrade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == jordan_sub_uuid))).scalar_one_or_none()
        if jgrade is None:
            jgrade = SubmissionGrade(submission_id=jordan_sub_uuid)
            s.add(jgrade)
        jbreakdown = []
        jai_grades = []
        for pos, pid in enumerate(LIN_PROBLEM_IDS, start=1):
            ans = JORDAN_FINAL_ANSWERS[pid]
            jbreakdown.append({
                "problem_id": pid, "score_status": "correct",
                "percent": 100.0, "confidence": 0.95,
                "feedback": "Correct.", "deductions": [], "student_answer": ans,
            })
            jai_grades.append({
                "problem_position": pos, "student_answer": ans,
                "score_status": "correct", "percent": 100.0, "confidence": 0.95,
                "reasoning": "Final answer matches the key.",
                "student_feedback": "Correct.", "deductions": [],
            })
        jgrade.breakdown = jbreakdown
        jgrade.ai_breakdown = {"grades": jai_grades}
        jgrade.final_score = 100.0
        jgrade.ai_score = 100.0
        jgrade.graded_at = now
        jgrade.grade_published_at = None
        flag_modified(jgrade, "breakdown")
        flag_modified(jgrade, "ai_breakdown")

        # Rebuild the integrity check as a COMPLETE flag_for_review.
        jexisting = (await s.execute(
            select(IntegrityCheckSubmission.id)
            .where(IntegrityCheckSubmission.submission_id == jordan_sub_uuid)
        )).scalars().all()
        for cid in jexisting:
            await s.execute(delete(IntegrityConversationTurn).where(
                IntegrityConversationTurn.integrity_check_submission_id == cid))
            await s.execute(delete(IntegrityCheckProblem).where(
                IntegrityCheckProblem.integrity_check_submission_id == cid))
        await s.execute(delete(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == jordan_sub_uuid))

        jcheck = IntegrityCheckSubmission(
            submission_id=jordan_sub_uuid,
            status="complete",
            disposition="flag_for_review",
            headline="Correct answer — but couldn't explain the steps",
            overall_summary=(
                "Jordan's final answer (x = 4.5) is correct and his written "
                "steps are clean — but he couldn't say why the 3x moved or "
                "adapt to a small change in the problem. Worth a quick "
                "conversation before this counts."),
            probe_selection_reason="verified_hardest_correct",
            resolution="unresolved",
        )
        s.add(jcheck)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=jcheck.id,
            bank_item_id=uuid.UUID(LIN_P4_BANK),
            sample_position=0,
            status="verdict_submitted",
            student_work_extraction=JORDAN_WORK_EXTRACTION,
            rubric={
                "paraphrase_originality": "low", "causal_fluency": "low",
                "transfer": "low", "prediction": "not_probed",
                "authority_resistance": "not_probed", "self_correction": "not_observed",
            },
            ai_reasoning=(
                "Answer and written steps are correct, but the student could "
                "not explain why 3x was subtracted, gave a memorized "
                "justification, and could not adapt the first step to a "
                "modified problem — no causal grasp of the method."),
            selected_reason="verified_hardest_correct",
        ))
        for i, (role, content) in enumerate(JORDAN_TURNS):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=jcheck.id,
                ordinal=i, role=role, content=content,
                seconds_on_turn=None, telemetry=None,
            ))
        print(f"seeded COMPLETE flag_for_review catch ({len(JORDAN_TURNS)} turns) "
              f"on Jordan's Linear Equations submission")

        # 4c ── push the Systems-of-Equations due date into the future so
        #        the student submit scene reads clean (no past-due "late"
        #        banner / warning-colored button on camera).
        await s.execute(
            text("update assignments set due_at = :d where id = :i"),
            {"d": now + timedelta(days=14),
             "i": "0bb2e228-d653-4d91-b03e-13e46006c498"},
        )
        print("pushed Systems-of-Equations due date to +14d (clean submit scene)")

        # 5 ── reset the workshop figure item to its canonical 8-15-17 so
        #       the scene 3d live reshape starts from a known state and
        #       any prior on-camera Accept doesn't accumulate.
        fig = (await s.execute(select(QuestionBankItem).where(
            QuestionBankItem.id == uuid.UUID("44e22fa0-bafb-4f01-bb4c-514e8a93228d")
        ))).scalar_one()
        fig.chat_messages = []
        flag_modified(fig, "chat_messages")

        await s.commit()
    print("prep complete")


if __name__ == "__main__":
    asyncio.run(main())
