"""Drives the REAL teacher app the way the web UI does, to verify the demo flow.

Reads tokens from /tmp/teacher_login.json. Prints every step. Persists ids to
/tmp/demo_state.json so later steps (screenshots, workshop) can pick them up.
"""
import base64, json, sys, time, pathlib, urllib.request, urllib.error

BASE = "http://localhost:8000/v1"
ROOT = pathlib.Path("/Users/benzhao/Documents/Veradic/math_teacher_app")
STATE = pathlib.Path("/tmp/demo_state.json")

tok = json.load(open("/tmp/teacher_login.json"))
ACCESS = tok["access_token"]

FOCUS = ("Short cumulative review from this sheet: one system solved with "
         "matrices, one right-triangle application with a diagram, one "
         "multi-step linear equation. Exam-style, increasing difficulty.")

def call(method, path, body=None, timeout=180):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {ACCESS}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, {"_err": e.read().decode()}

def save(state):
    STATE.write_text(json.dumps(state, indent=2))

def main():
    state = json.loads(STATE.read_text()) if STATE.exists() else {}

    # 1. Course: reuse existing "General Math" or create it.
    st, courses = call("GET", "/teacher/courses")
    print("GET /courses", st)
    clist = courses.get("courses", courses) if isinstance(courses, dict) else courses
    course = None
    for c in clist:
        if c.get("name") == "General Math":
            course = c; break
    if course is None:
        st, course = call("POST", "/teacher/courses",
                          {"name": "General Math", "subject": "math", "grade_level": "9"})
        print("POST /courses ->", st, course)
    cid = course["id"]
    state["course_id"] = cid
    print("course_id", cid)

    # 2. Unit
    st, units = call("GET", f"/teacher/courses/{cid}/units")
    ulist = units.get("units", units) if isinstance(units, dict) else units
    unit = None
    for u in (ulist or []):
        if u.get("name") == "Unit 5 - Systems & Applications":
            unit = u; break
    if unit is None:
        st, unit = call("POST", f"/teacher/courses/{cid}/units",
                        {"name": "Unit 5 - Systems & Applications"})
        print("POST /units ->", st, unit)
    uid = unit["id"]
    state["unit_id"] = uid
    print("unit_id", uid)

    # 3. Homework assignment
    st, hw = call("POST", f"/teacher/courses/{cid}/assignments",
                  {"title": "Unit 5 Cumulative Review",
                   "type": "homework", "unit_ids": [uid]})
    print("POST /assignments ->", st, hw)
    hwid = hw["id"]
    state["hw_id"] = hwid

    # 4. Upload worksheet PNG as a source document
    png = (ROOT / "docs/design/unit5_review_worksheet.png").read_bytes()
    b64 = base64.b64encode(png).decode()
    st, doc = call("POST", f"/teacher/courses/{cid}/documents",
                   {"file_base64": b64, "filename": "unit5_review_worksheet.png",
                    "unit_id": uid})
    print("POST /documents ->", st, {k: doc.get(k) for k in ("id","filename","file_type","file_size")} if isinstance(doc, dict) else doc)
    did = doc["id"]
    state["doc_id"] = did

    # 5. Generate exactly 3, constraint = focus, source = the worksheet
    st, job = call("POST", f"/teacher/courses/{cid}/question-bank/generate",
                   {"count": 3, "assignment_id": hwid, "unit_id": uid,
                    "document_ids": [did], "constraint": FOCUS, "params": None})
    print("POST /generate ->", st, job)
    jid = job["id"]
    state["job_id"] = jid
    save(state)

    # 6. Poll job
    for i in range(120):
        st, j = call("GET", f"/teacher/courses/{cid}/question-bank/generation-jobs/{jid}")
        print(f"  poll {i}: status={j.get('status')} produced={j.get('produced_count')} err={j.get('error_message')}")
        if j.get("status") in ("done", "failed"):
            break
        time.sleep(4)
    state["job_final"] = j
    save(state)

    # 7. Fetch pending items for this HW
    st, bank = call("GET", f"/teacher/courses/{cid}/question-bank?status_filter=pending&assignment_id={hwid}")
    items = bank.get("items", []) if isinstance(bank, dict) else []
    print(f"\nGENERATED {len(items)} ITEMS:")
    state["item_ids"] = [it["id"] for it in items]
    save(state)
    for it in items:
        print("="*70)
        print("id:", it["id"])
        for k in ("title", "difficulty", "question", "final_answer"):
            print(f"  {k}: {it.get(k)}")
        print("  solution_steps:", json.dumps(it.get("solution_steps"), indent=2)[:1500])
        print("  figure_spec?:", bool(it.get("figure_spec")), "figure_svg?:", bool(it.get("figure_svg")))
    save(state)
    print("\nSTATE:", json.dumps(state, indent=2)[:500])

if __name__ == "__main__":
    main()
