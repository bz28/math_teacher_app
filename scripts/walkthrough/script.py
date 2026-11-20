"""The walkthrough script: chapters -> beats -> {narration, actions}.

This is the one file to edit. Narration is plain text; it's spoken by the
placeholder TTS voice, written to the captions, and is the script the
founder reads from when re-recording the voice-over. Print it on its own:

    python -m scripts.walkthrough.script            # plain text, by beat id
    python -m scripts.walkthrough.script --markdown # for a doc / teleprompter

## How a beat plays

The narration starts when the beat starts. The actions run alongside it,
and the beat holds until the narration has finished (+0.4 s), so actions
should take no longer than the sentence that describes them. Put a
``wait(…)`` first when the words should land before the cursor moves.

``setup`` actions run before a chapter's title card and are cut from the
video (navigation and page loads never show).

## Targets

Elements are found by what a viewer can see, as ``kind:name``:

    "button:New Course"      role + accessible name (substring)
    "button=All"             role + exact name
    "text:Needs you today"   visible text (substring); "text=…" exact
    "placeholder:e.g. Algebra 1"
    "label:Unit name"
    "css:input[type=datetime-local]"

Scope with " >> " ("dialog >> button:Create"), and pick the n-th match
with a trailing "@n" ("button:Manage@1"). The first match is used
otherwise. Roles are ARIA roles: button, link, tab, textbox, combobox,
dialog, heading, region, radio, …

Paths and typed text may use {placeholders}: the seeded ids
({course_id}, {graded_hw_id}, {section_id}, {flagged_student_id},
{draft_hw_id}) and {due_local} (a datetime-local value five days out).

## The rules

No action may call the AI. Never click Generate / Create & generate /
Clone & generate, Grade now, Regrade, etc. The recorder also blocks those
API routes and fails the run if anything tries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Beat:
    id: str
    narration: str
    actions: list[tuple] = field(default_factory=list)


@dataclass
class Chapter:
    id: str
    title: str
    beats: list[Beat]
    setup: list[tuple] = field(default_factory=list)


# ── Action constructors (interpreted by record.py) ──────────────────────

def goto(path: str) -> tuple:
    return ("goto", path)


def click(target: str, pause: float = 0.6) -> tuple:
    return ("click", target, pause)


def hover(target: str, pause: float = 0.5) -> tuple:
    """Glide the cursor to an element (no click)."""
    return ("hover", target, pause)


def type_(target: str, text: str, pause: float = 0.3) -> tuple:
    """Click a field, then type into it key by key."""
    return ("type", target, text, pause)


def fill(target: str, text: str, pause: float = 0.4) -> tuple:
    """Click a field, then set its value at once (dates, pickers)."""
    return ("fill", target, text, pause)


def select(target: str, option: Any, pause: float = 0.6) -> tuple:
    """Choose an option of a native <select> by label (str) or index (int)."""
    return ("select", target, option, pause)


def scroll(target: str, pause: float = 0.4) -> tuple:
    """Smooth-scroll an element to the middle of the screen."""
    return ("scroll", target, pause)


def scroll_by(dy: int, pause: float = 0.4) -> tuple:
    return ("scroll_by", dy, pause)


def wait(seconds: float) -> tuple:
    return ("wait", seconds)


def wait_for(target: str) -> tuple:
    return ("wait_for", target)


def upload(target: str, fixture: str, pause: float = 0.8) -> tuple:
    """Click an upload control and choose a generated fixture file."""
    return ("upload", target, fixture, pause)


def download(target: str, pause: float = 0.8) -> tuple:
    return ("download", target, pause)


def press(key: str, pause: float = 0.4) -> tuple:
    return ("press", key, pause)


# How the TTS should say things the captions write differently.
PRONOUNCE = {
    "Algebra I": "Algebra one",
    "CSV": "C S V",
}

REVIEW_PAGE = "/school/teacher/courses/{course_id}/homework/{graded_hw_id}/sections/{section_id}/review"
COURSE = "/school/teacher/courses/{course_id}"


CHAPTERS: list[Chapter] = [
    # ── 1 ───────────────────────────────────────────────────────────────
    Chapter("welcome", "Welcome to Veradic", setup=[goto("/school/teacher")], beats=[
        Beat("welcome.loop",
             "Welcome to Veradic. Here's the whole idea in one breath. You assign "
             "homework, and students photograph their handwritten work. The AI "
             "grades it as a first pass. Then you review it and publish. No grade "
             "reaches a student until you publish it.",
             [wait(1.2), hover("heading:My Courses", 1.0), hover("text:Needs you today")]),
        Beat("welcome.queue",
             "This is My Courses, your home base. Needs you today gathers every "
             "submission that's waiting on you, across all your classes. Flagged "
             "work comes first, then work that's past due and still needs your "
             "review. Click any row to jump straight to that student.",
             [wait(1.5), hover("region:Needs you today >> link@0", 1.6),
              hover("region:Needs you today >> link@1", 1.0),
              hover("region:Needs you today >> link@2", 0.8)]),
        Beat("welcome.courses",
             "Further down are your courses, each showing how much is left to review.",
             [scroll("heading:Your courses"), hover("link:Algebra I", 0.8)]),
        Beat("welcome.sidebar",
             "On the left, Preview as student lets you see the app the way your "
             "students do. Video walkthrough brings back this video, and Report a "
             "problem sends a note straight to us.",
             [hover("text=Preview as student", 1.2), hover("text=Video walkthrough", 1.0),
              hover("text=Report a problem", 1.0)]),
    ]),

    # ── 2 ───────────────────────────────────────────────────────────────
    Chapter("courses", "Courses and sections", setup=[goto("/school/teacher")], beats=[
        Beat("courses.concept",
             "A course is a class you teach, like Algebra I. Sections are the "
             "periods you teach it in, and each one has its own roster. You build "
             "homework once for the course, then assign it to any of its sections.",
             [wait(1.0), hover("link:Algebra I", 1.5), hover("button:New Course")]),
        Beat("courses.new",
             "Let's make one. Click New Course, give it a name, pick the subject, "
             "and add a grade level if you like.",
             [click("button:New Course"),
              type_("dialog >> placeholder:e.g. Algebra 1", "Pre-Calculus"),
              select("dialog >> combobox", "Math"),
              type_("dialog >> spinbutton", "11")]),
        Beat("courses.create",
             "Create it, and it shows up in your list. Open it to set it up.",
             [click("dialog >> button:Create course"), wait_for("link:Pre-Calculus"),
              click("link:Pre-Calculus", 0.4), wait_for("heading:Pre-Calculus"),
              hover("button:New section")]),
        Beat("courses.section",
             "Now add a section for each period you teach. I'll call this one Period 2.",
             [click("button:New section"),
              type_("textbox:Section name", "Period 2"),
              click("button=Create")]),
        Beat("courses.code",
             "Every section gets its own join code the moment you create it.",
             [wait_for("button:Copy join code"), hover("button:Copy join code", 1.0)]),
    ]),

    # ── 3 ───────────────────────────────────────────────────────────────
    Chapter("students", "Adding students", beats=[
        Beat("students.code",
             "The quickest way to add students is that join code. Click it to copy "
             "it, then put it up on the board. Students enter the code when they "
             "sign up, and they land in this section.",
             [wait(1.0), click("button:Copy join code", 1.2),
              hover("text:Students enter this code to join")]),
        Beat("students.invite",
             "You can also invite students by email. Open Manage, paste in your "
             "list, and send. Each student gets an email with a link that brings "
             "them straight into the section.",
             [click("button=Manage"),
              type_("textbox:Invite students",
                    "jordan.lee@example.org, sam.ortiz@example.org, priya.nair@example.org"),
              click("button:Invite 3", 1.2)]),
        Beat("students.pending",
             "Each invite waits under Pending invites until the student accepts. "
             "You can resend one, or revoke it if it went to the wrong address.",
             [hover("text:Pending invites", 1.0), hover("button=Resend", 1.0),
              hover("button=Revoke", 1.0)]),
        Beat("students.close",
             "Once everyone's in, close enrollment, so the code stops letting new "
             "students join. You can reopen it any time.",
             [click("button:Close enrollment", 1.0), hover("text=Closed")]),
        Beat("students.regen",
             "And if a code ever ends up somewhere it shouldn't, regenerate it. "
             "The old code stops working right away.",
             [click("button:Regenerate join code"), hover("text:Generate a new code?", 0.8),
              click("button=Yes", 1.0), hover("button:Copy join code")]),
    ]),

    # ── 4 ───────────────────────────────────────────────────────────────
    Chapter("materials", "Units and materials", setup=[goto(COURSE + "?tab=materials")], beats=[
        Beat("materials.units",
             "Materials live in units. Think of a unit as a chapter of your "
             "textbook. Every homework belongs to at least one unit, so it pays to "
             "set them up the way you teach.",
             [wait(1.0), hover("button:Linear Equations", 1.2), hover("button:New Unit")]),
        Beat("materials.new_unit",
             "Click New Unit, and name it after the chapter. It appears in the list "
             "on the left, and clicking it opens the unit.",
             [click("button:New Unit"),
              type_("dialog >> textbox:Unit name", "Graphing Lines"),
              click("dialog >> button=Create", 0.8),
              click("button:Graphing Lines")]),
        Beat("materials.upload",
             "Then upload what you teach from: textbook pages, worksheets, your own "
             "notes. Photos and PDFs both work.",
             [upload("text=Upload Files", "chapter-4-graphing-lines.png", 1.0),
              wait_for("text:chapter-4-graphing-lines")]),
        Beat("materials.why",
             "When you have the AI write problems, you can point it at these files, "
             "so new problems match the way your class learns the material.",
             [hover("text:chapter-4-graphing-lines", 1.0)]),
        Beat("materials.view",
             "Hover over any file, and View opens it, so you can check you uploaded "
             "the right pages.",
             [hover("text:chapter-4-graphing-lines", 0.4), hover("text=View", 1.2)]),
    ]),

    # ── 5 ───────────────────────────────────────────────────────────────
    Chapter("homework", "Creating homework", setup=[goto(COURSE + "?tab=homework")], beats=[
        Beat("homework.list",
             "The Homework tab sorts everything by what it needs from you: homework "
             "to grade, what's due this week, and what's finished.",
             [wait(0.8), hover("heading:Needs grading", 1.2), hover("heading:Due this week", 0.8)]),
        Beat("homework.filter",
             "As the list grows, search it, or filter by status, section, or unit.",
             [scroll("placeholder:Search 9 homeworks", 0.6),
              hover("placeholder:Search 9 homeworks", 0.8),
              hover("combobox@0", 0.6), hover("combobox@1", 0.6), hover("combobox@2", 0.6)]),
        Beat("homework.details",
             "Click New homework. Step one is the details: a title, and the unit it "
             "belongs to.",
             [click("button:New homework"),
              type_("dialog >> placeholder:e.g. Quadratics HW", "Graphing Lines"),
              click("dialog >> button=Graphing Lines")]),
        Beat("homework.due",
             "Set a due date, and read the note underneath. The AI starts grading "
             "when that date passes.",
             [fill("dialog >> css:input[type=datetime-local]", "{due_local}"),
              hover("text:AI grading starts when this date passes", 1.2)]),
        Beat("homework.policy",
             "Pick a late policy, and choose sections. Leave sections empty to "
             "assign it to every section in the course.",
             [select("dialog >> combobox", 1),
              click("dialog >> button:Period 1", 0.8),
              hover("text:Leave empty to assign")]),
        Beat("homework.generate",
             "Step two is the problems. The AI can write new ones from your unit "
             "and your materials. You choose how many, and what to focus on. They "
             "land in a review queue for you to approve.",
             [click("dialog >> button:Continue"),
              hover("dialog >> button=10", 0.8),
              hover("dialog >> placeholder:e.g. word problems", 0.8),
              hover("dialog >> text:Source material", 0.8)]),
        Beat("homework.upload",
             "Already have a worksheet? Switch to Upload, add photos or a PDF, and "
             "the AI copies the problems from it word for word.",
             [click("dialog >> tab:Upload"), hover("dialog >> button:Add files", 1.0)]),
        Beat("homework.grading",
             "Step three is grading. Set the points, then add rules of your own, "
             "and common mistakes to watch for. On the right, you can read exactly "
             "how the AI will give full and partial credit.",
             [click("dialog >> tab:Generate", 0.3), click("dialog >> button:Continue"),
              hover("dialog >> textbox:Extra rules for this homework", 0.8),
              hover("dialog >> textbox:Common mistakes", 0.8),
              hover("dialog >> text:How the AI will grade this", 1.0)]),
        Beat("homework.review",
             "Step four is one last look. Create and generate would start writing "
             "problems, so for this walkthrough, I'll save it as a draft instead.",
             [click("dialog >> button:Continue"),
              hover("dialog >> button:Create & generate", 1.2),
              click("dialog >> button=Save as draft", 1.0)]),
        Beat("homework.editor",
             "Saving opens the draft in the editor. Here's one that already has its "
             "problems, each with its points. Open Solution to check the answer key "
             "and the worked steps.",
             [wait(1.0), click("text:Back to homework", 0.6),
              click("button:Systems of Equations", 1.0),
              wait_for("text:Problems & grading"),
              click("button:Solution@0", 1.0),
              hover("text:Worked solution", 0.8)]),
        Beat("homework.publish",
             "When it looks right, Publish sends it out to the sections you chose.",
             [hover("button:Publish", 1.2)]),
        Beat("homework.preview",
             "Before you do, Preview as student shows you exactly what your students "
             "will see, right down to the upload box. Anything you turn in here is a "
             "test run, and your students' work is untouched. Back to teacher view "
             "brings you home.",
             [click("button:Preview as student@1"),
              wait_for("button:Back to teacher view"), wait(1.2),
              scroll_by(350, 0.8),
              click("button:Back to teacher view"),
              wait_for("heading:My Courses"), wait_for("heading:Your courses"), wait(0.8)]),
    ]),

    # ── 6 ───────────────────────────────────────────────────────────────
    Chapter("grading", "Reviewing AI grades", setup=[goto(REVIEW_PAGE)], beats=[
        Beat("grading.roster",
             "Once homework is due, the AI grades each submission, and you review "
             "it. This is the grading page for one section. The roster puts what "
             "needs you on top. Needs your eyes is anything flagged, or where the "
             "AI wasn't sure. Below that, AI confident.",
             [wait(1.5), hover("heading:Slope & Intercepts", 1.2),
              hover("text=Needs your eyes", 2.5), hover("text=AI confident", 1.0)]),
        Beat("grading.open",
             "Let's open Zoe. Her photographed work is on the right. Each problem "
             "shows her answer, the answer key, and the AI's grade, with how "
             "confident it is.",
             [click("button:Zoe Ellis", 1.0), hover("img:Student handwritten submission", 1.4),
              hover("button:Expand problem 1", 1.0)]),
        Beat("grading.confident",
             "Problems the AI is confident about collapse to a quick confirm, and "
             "one button confirms them all. Even those aren't accepted until you "
             "say so. The one it was unsure about stays open.",
             [hover("text:stayed open because the AI was unsure", 1.4),
              hover("button:Confirm all 5 confident grades", 1.4)]),
        Beat("grading.reason",
             "The AI wasn't sure about problem five, so it left it open. Its "
             "reasoning: her work finds x equals 2 and y equals 5, but she wrote "
             "the point backwards. It suggested no credit.",
             [scroll("text:Suggestion:", 0.8), hover("text:The work finds x = 2", 1.0)]),
        Beat("grading.partial",
             "That's a judgment call, and it's yours. I'll give partial credit. The "
             "feedback underneath is what Zoe sees once the grade is published, "
             "and you can edit it.",
             [click("button=Partial", 1.0), hover("textbox:Add a sentence the student will see")]),
        Beat("grading.approve",
             "Then approve it. The AI's grade is only ever a suggestion, and nothing "
             "is accepted automatically.",
             [scroll("button:Approve ✓", 0.6), click("button:Approve ✓", 1.0)]),
        Beat("grading.publish",
             "To release grades, click Publish. Veradic tells you how many you "
             "haven't approved yet, and warns you about anything still flagged. "
             "I'll publish only the one I approved.",
             [click("button:Publish 9 grades", 1.0),
              hover("dialog >> text:grades you haven", 1.2),
              hover("dialog >> text:flagged for review", 1.0),
              click("dialog >> button:Publish only approved", 1.2)]),
        Beat("grading.done",
             "Zoe can now see her score and her feedback. Everyone else waits until "
             "you're ready.",
             [hover("button:Zoe Ellis", 1.0)]),
    ]),

    # ── 7 ───────────────────────────────────────────────────────────────
    Chapter("understanding-check", "The understanding check",
            setup=[goto(REVIEW_PAGE + "?student={flagged_student_id}")], beats=[
        Beat("uc.why",
             "After a student turns in work, Veradic asks them to explain it, in "
             "their own words, in a short conversation. It's there for learning. "
             "When a student is stuck, it helps them think it through.",
             [wait(1.5), hover("button:Ava Alvarez", 1.5)]),
        Beat("uc.never",
             "It never accuses anyone. When an explanation doesn't line up with the "
             "work, it flags it for you to look at, and you decide what it means.",
             [hover("text:couldn't explain the slope", 1.0), click("button:Details", 0.8)]),
        Beat("uc.card",
             "Here, Ava's answers were all correct, but she couldn't explain how "
             "she found the slope.",
             [hover("text:The written answers were right", 1.0)]),
        Beat("uc.conversation",
             "Open the conversation to read exactly what was said, and how long "
             "she took to reply.",
             [click("button:Conversation", 1.0), hover("dialog >> text:i just knew it was 2", 1.5),
              hover("dialog >> text:not sure", 1.5)]),
        Beat("uc.resolve",
             "Maybe she had an off day. Maybe it's worth a word after class. Either "
             "way, mark it reviewed, and pick an outcome. I'll choose Cleared.",
             [click("dialog >> button:Close", 0.8), click("button=Mark reviewed", 1.0),
              hover("button:Confirmed concern", 0.6), hover("button:Contacted student", 0.6),
              click("button:Cleared", 1.0)]),
        Beat("uc.after",
             "Once it's resolved, it leaves your queue, and the record shows you "
             "reviewed it.",
             [hover("button:Ava Alvarez", 1.0)]),
    ]),

    # ── 8 ───────────────────────────────────────────────────────────────
    Chapter("grades", "The gradebook", setup=[goto(COURSE + "?tab=grades")], beats=[
        Beat("grades.grid",
             "The Grades tab is your gradebook: every student and every homework, "
             "one section at a time. Only published grades show a score, and "
             "missing work is never averaged in as a zero.",
             [wait(1.0), hover("tab:Period 1", 1.0), hover("columnheader:Factoring Practice", 1.2),
              hover("columnheader:Avg", 1.0)]),
        Beat("grades.bands",
             "The bar along the top shows how the section is spread: three students "
             "at eighty-five or above, two in the seventies, and two under seventy. "
             "A small dot marks a grade where you changed the AI's suggestion, like "
             "Zoe's.",
             [hover("text:≥85%", 1.4), hover("text:<70%", 1.2),
              hover("text=76%", 1.2), hover("text:You changed the AI", 1.0)]),
        Beat("grades.attention",
             "Needs attention narrows it to students averaging below seventy percent.",
             [click("button:Needs attention", 1.2)]),
        Beat("grades.missing",
             "Missing work shows who hasn't turned in something that's past due.",
             [click("button:Missing work", 1.2)]),
        Beat("grades.student",
             "Click a name to see one student: their overall grade, what's missing, "
             "and how they're getting on with practice.",
             [click("button=All", 0.6), click("link=Liam Diaz", 1.0),
              wait_for("text:Published homework"), hover("text:Overall", 1.0),
              hover("text:Class avg", 1.0)]),
        Beat("grades.export",
             "Back on the gradebook, Export CSV downloads this section's grades, "
             "ready to import into Canvas, Schoology or PowerSchool.",
             [click("link:Back to Grades", 1.0), wait_for("button:Export CSV"),
              download("button:Export CSV", 1.0)]),
    ]),

    # ── 9 ───────────────────────────────────────────────────────────────
    Chapter("practice-insights", "Practice and Student Insights",
            setup=[goto(COURSE + "?tab=practice")], beats=[
        Beat("pi.practice",
             "Practice sets are ungraded. Students use them to work at a skill "
             "until it clicks. The quickest way to make one is to clone a homework.",
             [wait(1.0), click("button:New practice", 1.0)]),
        Beat("pi.clone",
             "Pick the homework and the problems to practice, and the AI writes new "
             "versions of each for you to approve. I won't generate one now, so "
             "I'll close this.",
             [select("dialog >> combobox:Source homework", 3, 1.2),
              hover("dialog >> button:Clone & generate", 1.0),
              click("dialog >> button:Close", 0.6)]),
        Beat("pi.insights",
             "Student Insights shows which problems most of a section got wrong on "
             "each homework. It only counts grades you've approved or published.",
             [click("button:Student Insights", 1.0),
              # The default section isn't stable between runs; pin it.
              click("button=Period 3", 0.6),
              select("combobox:Homework", "Factoring Practice", 1.0)]),
        Beat("pi.sections",
             "Each section gets its own view, since different periods often trip "
             "over different things. Pick a section up top, and a homework below it.",
             [hover("button=Period 3", 1.0), hover("button=Period 1", 1.0),
              hover("combobox:Homework", 1.0)]),
        Beat("pi.reteach",
             "Here, every student in Period 3 missed problem six. It's already picked for a "
             "practice set, so reteaching it is one click away.",
             [hover("text:got it wrong", 1.2), hover("button:Create practice set", 1.2)]),
        Beat("pi.other",
             "The rest of the homework is tucked under Other problems, if you want "
             "to add more to the set.",
             [click("button:Other problems", 1.4), hover("button:Other problems", 0.6)]),
        Beat("pi.loop",
             "That's the loop. Assign, let the AI take the first pass, review and "
             "publish, then reteach what the class missed. Thanks for watching.",
             [wait(1.0), hover("heading:Student Insights")]),
    ]),
]


def all_beats() -> list[Beat]:
    return [b for c in CHAPTERS for b in c.beats]


def _validate() -> None:
    ids = [b.id for b in all_beats()]
    dupes = {i for i in ids if ids.count(i) > 1}
    assert not dupes, f"duplicate beat ids: {dupes}"


_validate()


if __name__ == "__main__":
    import sys

    md = "--markdown" in sys.argv
    for n, ch in enumerate(CHAPTERS, 1):
        print(f"## {n}. {ch.title}  (#{ch.id})\n" if md else f"=== {n}. {ch.title} [{ch.id}]")
        for b in ch.beats:
            print(f"**{b.id}**  \n{b.narration}\n" if md else f"[{b.id}]\n{b.narration}\n")
