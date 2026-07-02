"""AI Workshop: revise the matrix problem into an inconsistent (no-solution)
2x2 system, then accept the AI proposal. Drives the real /chat + /chat/accept."""
import json, time, urllib.request, urllib.error
BASE = "http://localhost:8000/v1"
ACCESS = json.load(open("/tmp/teacher_login.json"))["access_token"]
st = json.load(open("/tmp/demo_state.json"))
MATRIX_ID = "fd53a721-4f6c-4240-8591-f18cf759c269"

MSG = ("Revise this into a 2x2 system that has NO solution (an inconsistent "
       "system of two parallel lines). Keep the matrix / determinant method, "
       "and update the solution so it shows the determinant is 0 and explains "
       "why the system is inconsistent and has no solution. Keep it exam-style.")

def call(method, path, body=None, timeout=180):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Authorization", f"Bearer {ACCESS}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, {"_err": e.read().decode()}

st_code, item = call("POST", f"/teacher/question-bank/{MATRIX_ID}/chat", {"message": MSG})
print("POST /chat ->", st_code)
if st_code != 200:
    print(item); raise SystemExit(1)
msgs = item["chat_messages"]
# find last ai message with an unresolved proposal
pending_idx = None
for i, m in enumerate(msgs):
    if m.get("role") == "ai" and m.get("proposal") and not m.get("accepted") and not m.get("discarded"):
        pending_idx = i
print("pending proposal index:", pending_idx)
prop = msgs[pending_idx]["proposal"]
print("AI reply text:", msgs[pending_idx].get("text", "")[:400])
print("PROPOSED question:", prop.get("question"))
print("PROPOSED final_answer:", prop.get("final_answer"))

st_code, item2 = call("POST", f"/teacher/question-bank/{MATRIX_ID}/chat/accept", {"message_index": pending_idx})
print("\nPOST /chat/accept ->", st_code)
print("LIVE question now:", item2["question"])
print("LIVE final_answer now:", item2["final_answer"])
print("\nLIVE solution_steps:")
print(json.dumps(item2["solution_steps"], indent=2))
json.dump(item2, open("/tmp/workshop_result.json", "w"), indent=2)
