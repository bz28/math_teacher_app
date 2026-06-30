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

from api.database import get_session_factory
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
     "$2(x-3) = 4x + 8$. Walk me through your very first move and why you "
     "did it."),
    ("student",
     "I distributed the 2 into the parentheses first, so 2(x - 3) becomes "
     "2x - 6. You have to multiply both the x and the -3 by the 2, "
     "otherwise the two sides aren't equal anymore."),
    ("agent",
     "Exactly - distributing across *both* terms is the key idea, and "
     "you said why. Once you had $2x - 6 = 4x + 8$, how did you decide which "
     "terms to move where?"),
    ("student",
     "I wanted the x's on one side and the plain numbers on the other, so I "
     "subtracted 4x from both sides to collect the variables. That's the part "
     "I rushed - I think I slipped a sign when I carried the 8 across."),
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

MAYA_WORK_EXTRACTION = {
    "steps": [
        {"problem_position": 3, "step_num": 1, "latex": "2(x-3) = 4x + 8",
         "plain_english": ""},
        {"problem_position": 3, "step_num": 2, "latex": "2x - 6 = 4x + 8",
         "plain_english": ""},
        {"problem_position": 3, "step_num": 3, "latex": "2x - 4x = 8 + 6",
         "plain_english": ""},
        {"problem_position": 3, "step_num": 4, "latex": "-2x = 14",
         "plain_english": ""},
        {"problem_position": 3, "step_num": 5, "latex": "x = -6",
         "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 3, "answer_latex": "x = -6", "answer_plain": "x = -6"},
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
            "where email in ('td_teacher_d592cc@t.com','maya_d52a@school.edu')"))
        print("marked onboarding tours seen for teacher + Maya")

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

        # 3 ── seed Maya's in-progress understanding check ───────────
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
            status="in_progress",
            disposition=None,
        )
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id,
            bank_item_id=uuid.UUID(MAYA_Q3_BANK),
            sample_position=0,
            status="pending",
            student_work_extraction=MAYA_WORK_EXTRACTION,
        ))
        for i, (role, content) in enumerate(TURNS):
            s.add(IntegrityConversationTurn(
                integrity_check_submission_id=check.id,
                ordinal=i, role=role, content=content,
                seconds_on_turn=None, telemetry=None,
            ))
        print(f"seeded understanding-check chat ({len(TURNS)} turns) on Maya's "
              "Linear Equations submission")

        await s.commit()
    print("prep complete")


if __name__ == "__main__":
    asyncio.run(main())
