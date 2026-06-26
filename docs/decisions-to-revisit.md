# Decisions to revisit (deferred, with the user)

A short log of product decisions that came out of the engine audits and are
intentionally **deferred for discussion**, not yet built. Revisit with the user.

---

## Learn mode: guided reveal vs. Socratic coach
**Status:** deferred — discuss before building.

**Current behavior (verified in code):** Learn mode is a *guided worked-solution
reveal*. At session start, `decompose_problem` computes the full solution
(steps + final answer) up front; the student reads each step and clicks
"I understand" (`request_advance`) to reveal the next one. The only student
actions are "ask a question about this step" and "advance"
(`api/schemas/session.py:40-42`, `api/core/session.py:279-325`). There is no
student *attempt* at a step and no judgment of an attempt — by design.

**The question:** keep it as a "walk me through it" reveal (current, and what the
`/learn` mode explainer copy promises), or build a real **Socratic loop**
(student attempts each step → adaptive hint on a wrong try → reveal only after a
genuine attempt — productive struggle / retrieval practice)? A hybrid is also on
the table: keep the reveal as default, add an optional "let me try this step
first" that judges the attempt + hints before revealing.

**Why deferred:** the Socratic loop is a real new build (a new student-attempt
action + a step-attempt judge + a hint ladder), and "reveal vs coach" is a
pedagogy/product call the user wants to make deliberately, not have inferred.

**Related dead code:** `api/core/judge.py` (`fire_and_forget_judge`) — a quality
gate for decompositions — has **no call sites** (verified). Decide whether to
wire it in (observability/gate on the decomposition) or delete it.
