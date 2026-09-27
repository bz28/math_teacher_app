"""Browser bug-bash of Workshop solution-step add / delete / move / undo.

Drives the real review page (WorkshopModal) against a running worktree stack
with Playwright, and after every action compares the rendered step list to
the API's. Scenarios: single-action undo, undo sequences, rapid input,
figures, proposal/lock guards, queue carry-over, student practice
downstream, network failure mid-save, keyboard (no accidental approve).

Standalone (not a CI test). Seeds its own worlds into the stack's DB:

    DATABASE_URL=<the stack's local DB> JWT_SECRET=<the stack's> \
    WEB_BASE=http://localhost:3230 API_BASE=http://localhost:8230/v1 \
    .venv/bin/python -m scripts.bugbash_workshop_steps [undo seq rapid ...]
"""

import asyncio
import os
import re
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

# This script seeds users/courses/items. Refuse anything but a local DB so
# it can never write into a shared or production database.
_DB = os.environ.get("DATABASE_URL", "")
if not re.search(r"@(localhost|127\.0\.0\.1)(:\d+)?/", _DB):
    _host = _DB.split("@")[-1].split("/")[0] if _DB else "unset"  # never echo credentials
    raise SystemExit(f"refusing to run: DATABASE_URL must point at localhost (host: {_host})")

import httpx

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from scripts.capture_workshop_step_editing import ALTITUDE_SVG
from tests.harness.browser import HarnessBrowser

WEB = os.environ.get("WEB_BASE", "http://localhost:3230")
API = os.environ.get("API_BASE", "http://localhost:8230/v1")
SHOTS = Path(os.environ.get("SHOTS", "/tmp/workshop-bugbash"))
SHOTS.mkdir(parents=True, exist_ok=True)

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    return ok


def st(t: str, d: str = "", fig: bool = False) -> dict:
    s = {"title": t, "description": d or f"{t} details"}
    if fig:
        s["figure_spec"] = {"kind": "bash"}
        s["figure_svg"] = ALTITUDE_SVG
    return s


async def seed(items: list[dict], *, publish: bool = False, locked_prev: bool = False) -> dict:
    async with get_session_factory()() as s:
        sfx = uuid.uuid4().hex[:6]
        school = School(name="Bash High", kind=SCHOOL_KIND_INDIVIDUAL,
                        contact_name="D", contact_email=f"d_{sfx}@t.com")
        s.add(school)
        await s.flush()
        teacher = User(email=f"bt_{sfx}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T", school_id=school.id)
        student = User(email=f"bs_{sfx}@t.com", password_hash=hash_password("x"),
                       grade_level=9, role="student", name="S", school_id=school.id)
        s.add_all([teacher, student])
        await s.flush()
        course = Course(name="Bash", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="U", position=0)
        section = Section(course_id=course.id, name="P1")
        s.add_all([unit, section])
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=student.id))
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                        title="Bash HW", type="homework",
                        status="published" if publish else "draft",
                        content={"problem_ids": []})
        practice = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                              title="Bash practice", type="practice", status="published",
                              content={"problem_ids": []})
        s.add_all([hw, practice])
        await s.flush()
        ids = {}
        for spec in items:
            it = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=practice.id if spec.get("practice") else hw.id,
                title=spec["title"], question=spec.get("q", spec["title"] + " question?"),
                solution_steps=spec.get("steps"), final_answer=spec.get("answer", "42"),
                difficulty="medium", format="frq",
                status=spec.get("status", "pending"), source="generated",
                chat_messages=spec.get("chat"), locked=spec.get("locked", False),
                distractors=[] if spec.get("practice") else None,
            )
            if spec.get("prev"):
                it.previous_question = "OLD question text"
                it.previous_solution_steps = [st("OLD step")]
                it.previous_final_answer = "OLD"
                it.previous_status = "approved"
            s.add(it)
            await s.flush()
            ids[spec["title"]] = str(it.id)
        if publish:
            hw.content = {"problem_ids": [ids[i["title"]] for i in items if not i.get("practice")]}
            s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id,
                                    published_at=datetime.now(UTC)))
        s.add(AssignmentSection(assignment_id=practice.id, section_id=section.id,
                                published_at=datetime.now(UTC)))
        tr = await create_refresh_token(s, teacher.id)
        sr = await create_refresh_token(s, student.id)
        await s.commit()
        return {"course": str(course.id), "hw": str(hw.id), "practice": str(practice.id), "ids": ids,
                "t": create_access_token(str(teacher.id), "teacher"), "tr": tr,
                "s": create_access_token(str(student.id), "student"), "sr": sr}


async def server_item(w: dict, item_id: str) -> dict:
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{API}/teacher/courses/{w['course']}/question-bank",
                        headers={"Authorization": f"Bearer {w['t']}"})
        return next(i for i in r.json()["items"] if i["id"] == item_id)


def titles(steps) -> list[str]:
    return [s["title"] for s in (steps or [])]


class UI:
    def __init__(self, page, w):
        self.page, self.w = page, w

    async def open_review(self, title: str) -> None:
        p = self.page
        await p.goto(f"{WEB}/school/teacher/courses/{self.w['course']}/homework/{self.w['hw']}/review",
                     wait_until="networkidle", timeout=60000)
        await p.wait_for_timeout(1200)
        for _ in range(5):
            if await p.get_by_text(title, exact=True).count():
                break
            await p.get_by_role("button", name="Skip", exact=False).first.click()
            await p.wait_for_timeout(500)
        await self.show_solution()

    async def show_solution(self) -> None:
        t = self.page.get_by_role("button", name="Show solution", exact=False)
        if await t.count():
            await t.first.click()
            await self.page.wait_for_timeout(300)

    async def titles(self) -> list[str]:
        loc = self.page.locator("div.group\\/step div.text-sm.font-semibold")
        return [t.strip() for t in await loc.all_inner_texts()]

    async def figure_step_index(self) -> list[int]:
        cards = self.page.locator("div.group\\/step")
        out = []
        for i in range(await cards.count()):
            if await cards.nth(i).locator("div.geometry-figure").count():
                out.append(i)
        return out

    async def settle(self, ms: int = 900) -> None:
        await self.page.wait_for_timeout(ms)

    async def undo(self) -> None:
        await self.page.get_by_role("button", name="Undo last change").click()
        await self.settle(1100)

    async def has_undo(self) -> bool:
        return await self.page.get_by_role("button", name="Undo last change").count() > 0

    async def move(self, n: int, d: str) -> None:
        await self.page.get_by_role("button", name=f"Move step {n} {d}").click()
        await self.settle()

    async def delete(self, n: int) -> None:
        await self.page.get_by_role("button", name=f"Delete step {n}").click()
        await self.page.get_by_role("button", name="Delete", exact=True).click()
        await self.settle(1100)

    async def add(self, title: str, desc: str = "") -> None:
        p = self.page
        b = p.get_by_role("button", name="Add step", exact=True)
        if not await b.count():
            b = p.get_by_role("button", name="Add the first step")
        await b.click()
        n = len(await self.titles()) + 1
        await p.get_by_label(f"Step {n} title").fill(title)
        if desc:
            await p.get_by_label(f"Step {n} explanation").fill(desc)
        await p.get_by_role("button", name=f"Add step {n}").click()
        await self.settle(1100)

    async def edit_title(self, n: int, new: str) -> None:
        card = self.page.locator("div.group\\/step").nth(n - 1)
        await card.get_by_role("button", name="Click to edit text").first.click()
        inp = card.locator("input[type=text]")
        await inp.fill(new)
        await inp.press("Enter")
        await self.settle(1100)

    async def edit_answer(self, new: str) -> None:
        box = self.page.locator("div.border-2").filter(has_text="Final answer").first
        await box.get_by_role("button", name="Click to edit text").click()
        inp = box.locator("input[type=text]")
        await inp.fill(new)
        await inp.press("Enter")
        await self.settle(1100)

    async def answer_text(self) -> str:
        box = self.page.locator("div.border-2").filter(has_text="Final answer").first
        return (await box.inner_text()).replace("FINAL ANSWER", "").replace("Final answer", "").strip()

    async def error(self) -> str:
        e = self.page.locator("p.text-red-600")
        return (await e.inner_text()) if await e.count() else ""

    async def shot(self, name: str) -> None:
        await self.page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)


async def agree(ui: UI, w: dict, iid: str, expect: list[str], name: str) -> None:
    got_ui = await ui.titles()
    got_srv = titles((await server_item(w, iid))["solution_steps"])
    ok = got_ui == expect and got_srv == expect
    if not ok:
        await ui.shot(name.replace(" ", "_"))
    check(name, ok, f"ui={got_ui} server={got_srv} expected={expect}")


ABC = [st("A"), st("B", fig=True), st("C")]


async def scenario_single_undos(browser) -> None:
    for action in ["add", "delete", "up", "down", "edit", "answer"]:
        w = await seed([{"title": "Alpha", "steps": ABC}])
        iid = w["ids"]["Alpha"]
        async with browser.authed_page(w["t"], w["tr"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 1600})
            ui = UI(page, w)
            await ui.open_review("Alpha")
            expect_after = {
                "add": ["A", "B", "C", "D"], "delete": ["A", "C"], "up": ["B", "A", "C"],
                "down": ["A", "C", "B"], "edit": ["A2", "B", "C"], "answer": ["A", "B", "C"],
            }[action]
            if action == "add":
                await ui.add("D")
            elif action == "delete":
                await ui.delete(2)
            elif action == "up":
                await ui.move(2, "up")
            elif action == "down":
                await ui.move(2, "down")
            elif action == "edit":
                await ui.edit_title(1, "A2")
            else:
                await ui.edit_answer("43")
            await agree(ui, w, iid, expect_after, f"1/{action}: applied")
            if action == "answer":
                srv = await server_item(w, iid)
                check("1/answer: server answer 43", srv["final_answer"] == "43", srv["final_answer"])
            check(f"1/{action}: undo visible", await ui.has_undo())
            await ui.undo()
            await agree(ui, w, iid, ["A", "B", "C"], f"1/{action}: undo restores")
            srv = await server_item(w, iid)
            check(f"1/{action}: figure on B after undo",
                  (srv["solution_steps"][1].get("figure_svg") == ALTITUDE_SVG)
                  and (await ui.figure_step_index()) == [1],
                  f"ui_fig={await ui.figure_step_index()}")
            check(f"1/{action}: answer restored", srv["final_answer"] == "42"
                  and "42" in await ui.answer_text(), f"{srv['final_answer']} / {await ui.answer_text()}")
            check(f"1/{action}: one-level (undo gone, has_previous_version false)",
                  not await ui.has_undo() and not srv["has_previous_version"],
                  f"ui_undo={await ui.has_undo()} srv={srv['has_previous_version']}")
            check(f"1/{action}: no error", not await ui.error(), await ui.error())


async def scenario_sequences(browser) -> None:
    # delete → undo → delete
    w = await seed([{"title": "Alpha", "steps": ABC}])
    iid = w["ids"]["Alpha"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Alpha")
        await ui.delete(1)
        await ui.undo()
        await ui.delete(3)
        await agree(ui, w, iid, ["A", "B"], "2/delete-undo-delete")
        # move → move → undo (undo only the last move)
        await ui.move(1, "down")   # B A
        await ui.move(2, "up")     # A B
        await ui.undo()            # back to B A
        await agree(ui, w, iid, ["B", "A"], "2/move-move-undo reverts only last move")
        # edit → add → undo (keeps edit, drops add)
        await ui.edit_title(1, "B2")
        await ui.add("Z")
        await ui.undo()
        await agree(ui, w, iid, ["B2", "A"], "2/edit-add-undo keeps edit")
        # undo with nothing left
        check("2/nothing-to-undo: button hidden", not await ui.has_undo())
        async with httpx.AsyncClient() as c:
            r = await c.post(f"{API}/teacher/question-bank/{iid}/revert",
                             headers={"Authorization": f"Bearer {w['t']}"})
        check("2/nothing-to-undo: API 400", r.status_code == 400, str(r.status_code))
        # delete every step → undo
        await ui.delete(2)
        await ui.delete(1)
        empty_ui = await page.get_by_text("No solution steps yet.").count()
        srv = await server_item(w, iid)
        check("2/delete-all: empty state + server None", empty_ui == 1 and srv["solution_steps"] is None,
              f"{empty_ui} {srv['solution_steps']}")
        await ui.undo()
        await agree(ui, w, iid, ["B2"], "2/delete-last-undo restores last step")

    # failed-solve: add first step → undo
    w = await seed([{"title": "Failed", "steps": None, "answer": SOLUTION_FAILED_SENTINEL}])
    iid = w["ids"]["Failed"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Failed")
        await ui.add("First")
        await agree(ui, w, iid, ["First"], "2/failed: add first step")
        await ui.undo()
        srv = await server_item(w, iid)
        check("2/failed: undo → no steps, sentinel kept, empty state shown",
              srv["solution_steps"] is None and srv["final_answer"] == SOLUTION_FAILED_SENTINEL
              and await page.get_by_text("No solution steps yet.").count() == 1
              and await page.get_by_role("button", name="Add the first step").count() == 1,
              f"{srv['solution_steps']} {srv['final_answer']}")
        await ui.edit_answer("12 ft")
        await ui.undo()
        srv = await server_item(w, iid)
        check("2/failed: answer edit → undo restores sentinel + blank field prompt",
              srv["final_answer"] == SOLUTION_FAILED_SENTINEL
              and await page.get_by_text("Click to add the final answer").count() == 1,
              srv["final_answer"])


async def scenario_rapid(browser) -> None:
    w = await seed([{"title": "Alpha", "steps": ABC + [st("D")]}])
    iid = w["ids"]["Alpha"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1700})
        ui = UI(page, w)
        await ui.open_review("Alpha")
        await page.get_by_role("button", name="Move step 3 up").dblclick()
        await ui.settle(1500)
        u, s_ = await ui.titles(), titles((await server_item(w, iid))["solution_steps"])
        check("3/dblclick move: UI == server, no dup/vanish",
              u == s_ and sorted(u) == ["A", "B", "C", "D"], f"ui={u} srv={s_}")
        await page.get_by_role("button", name="Move step 4 up").click()
        await page.get_by_role("button", name="Move step 1 down").click(timeout=3000, force=True)
        await ui.settle(1500)
        u, s_ = await ui.titles(), titles((await server_item(w, iid))["solution_steps"])
        check("3/two quick moves: UI == server, no dup/vanish",
              u == s_ and sorted(u) == ["A", "B", "C", "D"], f"ui={u} srv={s_}")
        # double-click trash then confirm
        await page.get_by_role("button", name="Delete step 4").dblclick()
        await ui.settle(300)
        conf = await page.get_by_role("button", name="Delete", exact=True).count()
        n_after_dbl = len(await ui.titles())
        print(f"      dblclick trash: confirm open={conf}, steps={n_after_dbl} (2nd click lands on Keep)")
        check("3/dblclick trash deletes nothing by itself", n_after_dbl == 4, str(n_after_dbl))
        if not conf:
            await page.get_by_role("button", name="Delete step 4").click()
            await ui.settle(300)
            conf = await page.get_by_role("button", name="Delete", exact=True).count()
        await page.get_by_role("button", name="Delete", exact=True).dblclick()
        await ui.settle(1500)
        u, s_ = await ui.titles(), titles((await server_item(w, iid))["solution_steps"])
        check("3/dblclick delete+confirm: exactly one step removed",
              conf == 1 and u == s_ and len(u) == 3, f"conf={conf} ui={u} srv={s_}")
        # double-click add, then double-click submit
        await page.get_by_role("button", name="Add step", exact=True).dblclick()
        await page.get_by_label("Step 4 title").fill("E")
        await page.get_by_role("button", name="Add step 4").dblclick()
        await ui.settle(1500)
        u, s_ = await ui.titles(), titles((await server_item(w, iid))["solution_steps"])
        check("3/dblclick add submit: exactly one step added",
              u == s_ and u.count("E") == 1 and len(u) == 4, f"ui={u} srv={s_}")
        # edit a step then immediately click move on another
        card = page.locator("div.group\\/step").nth(0)
        await card.get_by_role("button", name="Click to edit text").first.click()
        await card.locator("input[type=text]").fill("EDITED")
        before = await ui.titles()
        await page.get_by_role("button", name="Move step 3 up").click()
        await ui.settle(1500)
        u, s_ = await ui.titles(), titles((await server_item(w, iid))["solution_steps"])
        check("3/edit then move: edit saved, UI == server", u == s_ and "EDITED" in u,
              f"before={before} ui={u} srv={s_}")
        moved = u.index("EDITED") == 0 and u != [("EDITED" if i == 0 else t) for i, t in enumerate(before)]
        print(f"      (move after edit {'applied' if moved else 'dropped'}; ui={u})")


async def scenario_figures(browser) -> None:
    w = await seed([{"title": "Alpha", "steps": ABC}])
    iid = w["ids"]["Alpha"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1700})
        ui = UI(page, w)
        await ui.open_review("Alpha")

        async def fig_on(title: str, name: str) -> None:
            srv = (await server_item(w, iid))["solution_steps"] or []
            srv_idx = [i for i, s in enumerate(srv) if s.get("figure_svg")]
            ui_idx = await ui.figure_step_index()
            ts = await ui.titles()
            want = [ts.index(title)] if title in ts else []
            check(name, srv_idx == want and ui_idx == want and
                  all(srv[i]["title"] == title for i in srv_idx), f"srv={srv_idx} ui={ui_idx} want={want}")

        await ui.move(2, "down")
        await fig_on("B", "4/figure follows B on move down")
        await ui.move(3, "up")
        await ui.move(2, "up")
        await fig_on("B", "4/figure follows B on move up x2")
        await ui.delete(1)
        await fig_on("B", "4/figure absent after deleting B")
        await ui.undo()
        await fig_on("B", "4/figure back on B after undo")
        await ui.delete(2)
        await fig_on("B", "4/figure stays on B after deleting another step")


async def scenario_guards(browser) -> None:
    proposal = {"question": None, "final_answer": None,
                "solution_steps": [{"title": "P1", "description": "p"}, {"title": "P2", "description": "p"}]}
    chat = [{"role": "teacher", "text": "redo"},
            {"role": "ai", "text": "Here's a revision.", "proposal": proposal}]
    w = await seed([{"title": "Prop", "steps": ABC, "chat": chat, "prev": True}])
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Prop")
        n_ctrl = await page.locator("[aria-label^='Move step'], [aria-label^='Delete step']").count()
        n_add = await page.get_by_role("button", name="Add step", exact=True).count()
        n_edit = await page.locator("div.group\\/step").get_by_role("button", name="Click to edit text").count()
        await ui.shot("guard_proposal")
        check("5/proposal pending: no step controls/add/editors", n_ctrl == 0 and n_add == 0 and n_edit == 0,
              f"ctrl={n_ctrl} add={n_add} edit={n_edit}")
        await page.keyboard.press("Enter")
        await ui.settle(800)
        srv = await server_item(w, w["ids"]["Prop"])
        check("5/proposal pending: Enter doesn't approve", srv["status"] == "pending", srv["status"])
        if await ui.has_undo():
            await ui.undo()
            srv = await server_item(w, w["ids"]["Prop"])
            err = await ui.error()
            check("5/proposal pending: undo blocked", titles(srv["solution_steps"]) == ["A", "B", "C"]
                  and "proposal" in err.lower(), f"{titles(srv['solution_steps'])} err={err!r}")
            await ui.shot("guard_proposal_undo")
        else:
            check("5/proposal pending: undo blocked (hidden)", True)

    # Locked: item in a published HW that also carries an older undo snapshot.
    w = await seed([{"title": "Locked", "steps": ABC, "status": "approved", "locked": True, "prev": True}],
                   publish=True)
    iid = w["ids"]["Locked"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await page.goto(f"{WEB}/school/teacher/courses/{w['course']}/homework/{w['hw']}",
                        wait_until="networkidle", timeout=60000)
        await ui.settle(1500)
        opened = False
        for cand in [page.get_by_text("Locked question?", exact=False), page.get_by_text("Locked", exact=True)]:
            if await cand.count():
                await cand.first.click()
                await ui.settle(1200)
                if await page.get_by_text("This question is in published homework", exact=False).count():
                    opened = True
                    break
        if not opened:
            await ui.shot("locked_open_failed")
            print("      could not open locked item via HW page; buttons:",
                  (await page.get_by_role("button").all_inner_texts())[:30])
        else:
            await ui.show_solution()
            n_ctrl = await page.locator("[aria-label^='Move step'], [aria-label^='Delete step']").count()
            n_add = await page.get_by_role("button", name="Add step", exact=True).count()
            check("5/locked: no step controls/add", n_ctrl == 0 and n_add == 0, f"ctrl={n_ctrl} add={n_add}")
            undo_visible = await ui.has_undo()
            await ui.shot("guard_locked")
            check("5/locked: undo not offered", not undo_visible, "Undo last change shown on a locked item")
        async with httpx.AsyncClient() as c:
            h = {"Authorization": f"Bearer {w['t']}"}
            r = await c.patch(f"{API}/teacher/question-bank/{iid}", json={"solution_steps": [st("X")]}, headers=h)
            check("5/locked: PATCH steps 409", r.status_code == 409, str(r.status_code))
            r = await c.post(f"{API}/teacher/question-bank/{iid}/revert", headers=h)
            check("5/locked: revert refused", r.status_code == 409, f"{r.status_code} {r.text[:80]}")
        srv = await server_item(w, iid)
        check("5/locked: content unchanged", titles(srv["solution_steps"]) == ["A", "B", "C"]
              and srv["question"] != "OLD question text", f"{titles(srv['solution_steps'])} {srv['question'][:30]}")


async def scenario_queue(browser) -> None:
    w = await seed([{"title": "Qone", "steps": ABC}, {"title": "Qtwo", "steps": [st("X"), st("Y")]}])
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await page.goto(f"{WEB}/school/teacher/courses/{w['course']}/homework/{w['hw']}/review",
                        wait_until="networkidle", timeout=60000)
        await ui.settle(1200)
        first = "Qone" if await page.get_by_text("Qone", exact=True).count() else "Qtwo"
        second = "Qtwo" if first == "Qone" else "Qone"
        await ui.show_solution()
        await ui.delete(1)
        # Leave a draft open and a delete-confirm open, then approve via the footer.
        await page.get_by_role("button", name="Delete step 1").click()
        await page.get_by_role("button", name="Approve", exact=False).last.click()
        await ui.settle(1500)
        on_second = await page.get_by_text(second, exact=True).count() > 0
        check("6/approve advanced", on_second)
        await ui.show_solution()
        confirm_left = await page.get_by_text("Delete step", exact=False).filter(has_text="?").count()
        undo_left = await ui.has_undo()
        await ui.shot("queue_after_approve")
        check("6/no delete-confirm carried over", confirm_left == 0, str(confirm_left))
        check("6/no undo carried over to next item", not undo_left,
              "'Undo last change' visible on the next item (it has no previous version)")
        if undo_left:
            await ui.undo()
            err = await ui.error()
            print("      clicking carried-over undo →", repr(err))
        # draft carry-over
        await page.get_by_role("button", name="Add step", exact=True).click()
        await page.get_by_label("Step 3 title").fill("draft text")
        await page.get_by_role("button", name="Skip", exact=False).last.click(force=True)
        await ui.settle(1000)
        await ui.show_solution()
        drafts = await page.locator("[aria-label^='New step']").count()
        check("6/no open draft carried over after skip", drafts == 0, str(drafts))
        srv1 = await server_item(w, w["ids"][first])
        check("6/first item approved w/ its edit", srv1["status"] == "approved"
              and titles(srv1["solution_steps"]) == (["B", "C"] if first == "Qone" else ["Y"]),
              f"{srv1['status']} {titles(srv1['solution_steps'])}")


async def scenario_student(browser) -> None:
    w = await seed([{"title": "Prac", "steps": ABC, "status": "approved", "practice": True}])
    iid = w["ids"]["Prac"]
    async with httpx.AsyncClient() as c:
        h = {"Authorization": f"Bearer {w['t']}"}
        r = await c.patch(f"{API}/teacher/question-bank/{iid}",
                          json={"solution_steps": [ABC[2], ABC[1], {"title": "New", "description": "nd"}]},
                          headers=h)
        check("7/teacher PATCH ok", r.status_code == 200, r.text[:100])
    async with browser.authed_page(w["s"], w["sr"]) as page:
        await page.set_viewport_size({"width": 1280, "height": 1100})
        await page.goto(f"{WEB}/school/student/courses/{w['course']}/practice/{w['practice']}",
                        wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1200)
        await page.get_by_role("button", name="Learn", exact=False).first.click()
        await page.wait_for_timeout(1000)
        seen = []
        for _ in range(4):
            t = await page.locator("text=/Step \\d —/").all_inner_texts()
            seen.extend(t)
            b = page.get_by_role("button", name="I understand")
            if not await b.count():
                break
            await b.first.click()
            await page.wait_for_timeout(700)
        await page.screenshot(path=str(SHOTS / "student_learn.png"), full_page=True)
        uniq = list(dict.fromkeys(x.strip() for x in seen))
        check("7/student sees edited steps in order",
              [u.split("—")[-1].strip() for u in uniq][:3] == ["C", "B", "New"], str(uniq))


async def scenario_network(browser) -> None:
    w = await seed([{"title": "Alpha", "steps": ABC}])
    iid = w["ids"]["Alpha"]
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Alpha")

        async def abort(route):
            if route.request.method in ("PATCH", "POST"):
                await route.abort()
            else:
                await route.continue_()

        await page.route("**/question-bank/**", abort)
        await ui.move(2, "up")
        await agree(ui, w, iid, ["A", "B", "C"], "8/aborted move: no phantom reorder")
        err1 = await ui.error()
        check("8/aborted move: error shown", bool(err1), err1)
        await ui.delete(1)
        await agree(ui, w, iid, ["A", "B", "C"], "8/aborted delete: step still there")
        confirm_open = await page.get_by_role("button", name="Delete", exact=True).count()
        check("8/aborted delete: confirm stays for retry", confirm_open == 1, str(confirm_open))
        await page.get_by_role("button", name="Keep").click()
        await page.get_by_role("button", name="Add step", exact=True).click()
        await page.get_by_label("Step 4 title").fill("Kept text")
        await page.get_by_role("button", name="Add step 4").click()
        await ui.settle(1000)
        kept = await page.get_by_label("Step 4 title").input_value() if await page.get_by_label("Step 4 title").count() else None
        check("8/aborted add: draft kept with text", kept == "Kept text", str(kept))
        await ui.shot("network_abort")
        await page.unroute("**/question-bank/**")
        await page.get_by_role("button", name="Add step 4").click()
        await ui.settle(1100)
        await agree(ui, w, iid, ["A", "B", "C", "Kept text"], "8/retry add after network restored")
        check("8/error cleared after success", not await ui.error(), await ui.error())
        await ui.move(4, "up")
        await agree(ui, w, iid, ["A", "B", "Kept text", "C"], "8/next action works")


async def scenario_keyboard(browser) -> None:
    w = await seed([{"title": "Alpha", "steps": ABC}, {"title": "Failed", "steps": None,
                                                        "answer": SOLUTION_FAILED_SENTINEL}])
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Alpha")
        iid = w["ids"]["Alpha"]
        steps_done = []
        for label in ["Move step 2 up", "Move step 1 down", "Delete step 3"]:
            await page.get_by_role("button", name=label).focus()
            await page.keyboard.press("Enter")
            await ui.settle(1000)
            steps_done.append(label)
            print("      after", label, "status", (await server_item(w, iid))["status"],
                  "focus", await page.evaluate("document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName"))
            if label.startswith("Delete"):
                await page.keyboard.press("Enter")  # focus is on Keep (autoFocus) → cancels
                await ui.settle(500)
                print("      after Keep", (await server_item(w, iid))["status"],
                      await page.evaluate("document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent"))
        await page.get_by_role("button", name="Add step", exact=True).focus()
        await page.keyboard.press("Enter")
        await page.keyboard.type("Typed")
        await page.keyboard.press("Control+Enter")
        await ui.settle(1100)
        print("      after add", (await server_item(w, iid))["status"], await page.evaluate("document.activeElement?.textContent"))
        await page.keyboard.press("Enter")  # on "+ Add step" → opens draft
        await ui.settle(400)
        await page.keyboard.press("Escape")  # cancels draft only
        await ui.settle(400)
        print("      after esc", (await server_item(w, iid))["status"], await page.evaluate("document.activeElement?.textContent"))
        # Click-to-edit title via keyboard, Enter commits.
        card = page.locator("div.group\\/step").nth(0)
        await card.get_by_role("button", name="Click to edit text").first.focus()
        await page.keyboard.press("Enter")
        await page.keyboard.press("End")
        await page.keyboard.type("!")
        await page.keyboard.press("Enter")
        await ui.settle(1100)
        print("      after title edit", (await server_item(w, iid))["status"], await page.evaluate("document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName"))
        await page.keyboard.press("Enter")  # focus after commit — must not approve
        await ui.settle(800)
        srv = await server_item(w, iid)
        still_open = await page.get_by_text("Alpha", exact=True).count() > 0
        check("9/keyboard session never approved", srv["status"] == "pending", srv["status"])
        check("9/workshop still on item after Esc", still_open)
        print("      keyboard final steps:", titles(srv["solution_steps"]))
        # Footer shortcut still approves when focus is not in the steps list.
        await page.locator("body").click(position={"x": 5, "y": 5})
        await page.keyboard.press("a")
        await ui.settle(1200)
        srv = await server_item(w, iid)
        check("9/'a' shortcut still approves", srv["status"] == "approved", srv["status"])


async def scenario_keyboard_fields(browser) -> None:
    """Enter-commit on the NON-step click-to-edit fields must not approve;
    Enter from the page body and after a mouse click on a footer button
    still approves; a slow save never yanks focus out of the chat box."""
    focus_js = ("document.activeElement === document.body ? 'BODY' : "
                "(document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)")
    for field in ["question", "answer"]:
        w = await seed([{"title": "Kq", "steps": ABC}, {"title": "Kq2", "steps": ABC}])
        iid = w["ids"]["Kq"]
        async with browser.authed_page(w["t"], w["tr"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 1600})
            ui = UI(page, w)
            await ui.open_review("Kq")
            if field == "question":
                btn = page.get_by_role("button", name="Click to edit text").first
            else:
                box = page.locator("div.border-2").filter(has_text="Final answer").first
                btn = box.get_by_role("button", name="Click to edit text")
            await btn.focus()
            await page.keyboard.press("Enter")          # opens the editor
            await page.keyboard.press("End")
            await page.keyboard.type(" edited")
            # single-line commits on Enter; the multiline question on Cmd/Ctrl+Enter
            await page.keyboard.press("Control+Enter" if field == "question" else "Enter")
            await ui.settle(1200)
            f = await page.evaluate(focus_js)
            await page.keyboard.press("Enter")          # must re-open the field, not approve
            await ui.settle(900)
            srv = await server_item(w, iid)
            val = srv["question"] if field == "question" else srv["final_answer"]
            check(f"9b/{field}: Enter-commit saved", "edited" in val, val)
            check(f"9b/{field}: focus back on the field after commit", f == "Click to edit text", f)
            check(f"9b/{field}: next Enter does not approve", srv["status"] == "pending", srv["status"])

    # Enter from body still approves; footer mouse-click then Enter still approves.
    w = await seed([{"title": "Kb1", "steps": ABC}, {"title": "Kb2", "steps": ABC}])
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await page.goto(f"{WEB}/school/teacher/courses/{w['course']}/homework/{w['hw']}/review",
                        wait_until="networkidle", timeout=60000)
        await ui.settle(1200)
        first = "Kb1" if await page.get_by_text("Kb1", exact=True).count() else "Kb2"
        second = "Kb2" if first == "Kb1" else "Kb1"
        await page.evaluate("document.activeElement && document.activeElement.blur()")
        await page.keyboard.press("Enter")
        await ui.settle(1500)
        check("9b/Enter from body approves", (await server_item(w, w["ids"][first]))["status"] == "approved")
        await page.get_by_role("button", name="Hide", exact=False).last.click()   # footer chat toggle
        await ui.settle(300)
        await page.keyboard.press("Enter")
        await ui.settle(1500)
        check("9b/footer mouse-click then Enter approves",
              (await server_item(w, w["ids"][second]))["status"] == "approved")

    # Slow save: commit with Enter, click into chat before the save lands.
    w = await seed([{"title": "Ks", "steps": ABC}])
    async with browser.authed_page(w["t"], w["tr"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1600})
        ui = UI(page, w)
        await ui.open_review("Ks")

        async def slow(route):
            if route.request.method == "PATCH":
                await asyncio.sleep(2.5)
            await route.continue_()

        await page.route("**/question-bank/**", slow)
        card = page.locator("div.group\\/step").nth(0)
        await card.get_by_role("button", name="Click to edit text").first.focus()
        await page.keyboard.press("Enter")
        await page.keyboard.type("!")
        await page.keyboard.press("Enter")
        await ui.settle(200)
        # The chat box is disabled while a save is in flight, so move focus to
        # something that stays focusable (as Tab would): the page's back link.
        await page.get_by_role("link", name="Back to homework", exact=False).first.focus()
        await ui.settle(3500)                            # save lands, busy clears
        tag = await page.evaluate("document.activeElement?.tagName")
        check("9b/slow save doesn't steal focus the teacher moved", tag == "A", str(tag))
        await page.unroute("**/question-bank/**")


SCENARIOS = {
    "undo": scenario_single_undos, "seq": scenario_sequences, "rapid": scenario_rapid,
    "fig": scenario_figures, "guards": scenario_guards, "queue": scenario_queue,
    "student": scenario_student, "net": scenario_network, "kbd": scenario_keyboard,
    "kbd2": scenario_keyboard_fields,
}


async def main() -> None:
    which = sys.argv[1:] or list(SCENARIOS)
    async with HarnessBrowser(WEB) as browser:
        for name in which:
            print(f"== {name}")
            try:
                await SCENARIOS[name](browser)
            except Exception as e:  # noqa: BLE001
                check(f"{name}: crashed", False, f"{type(e).__name__}: {str(e)[:300]}")
    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} passed")
    for n, _, d in fails:
        print("  FAIL", n, "::", d)


asyncio.run(main())
