# Smart Grouped Variation Generation (v2)

> **Status:** Idea / skeleton — not built yet
> **References:** `plans/question-bank-redesign-v2.md` (the current per-question nudge this replaces)
> **When:** Build after the current question-bank redesign ships and we have real teacher usage to inform clustering

---

## The big idea

Today, after a teacher approves a single primary into a homework, we
nudge them to generate practice variations *for that one question* (2
by default). It works but it's wasteful:

- A homework with 8 questions on factoring quadratics generates **8
  separate variation pools** with heavy overlap
- Teacher has to review **16+ variations**, many of which are
  near-duplicates of each other
- Compute cost scales linearly with question count even when concepts
  repeat
- Each per-question pool is small, so per-student exhaustion happens fast

**Replace it with publish-time, group-aware generation.**

When the teacher clicks **Publish** on a draft homework:

1. Backend runs a **clustering call** on the HW's primary problems →
   returns proposed groupings ("Q1, Q3, Q7 are all factoring; Q2, Q5
   are linear systems; Q4, Q6, Q8 are word problems with rates")
2. Modal shows the groups with an editable preview — teacher can split
   / merge / move questions between groups, or override to "every
   question is its own group" for power-user mode
3. For each group: kick off one `generate-similar` job with the group
   as seed → variations land linked to the **group**, not a single
   parent
4. Variations queue up in pending, teacher reviews them via the
   existing Flow B review modal — fewer total because groups
   consolidate concepts
5. Approved variations sit in the group pool. Student-side practice for
   any question in the group pulls from the same shared pool

The teacher reviews variations either way, so the win isn't "skip
review" — it's "review fewer, broader, less-redundant variations and
get bigger pools per concept."

---

## Why it's better than per-question

| | Per question (today) | Group-based (v2) |
|---|---|---|
| Generation calls | N (one per question) | G (one per group, G ≤ N) |
| Variations to review | N × M | G × M |
| Pool size per concept | M | M (but shared across multiple questions) |
| Near-duplicate variations | Common | Rare (groups dedupe concepts) |
| Teacher decision points | Mid-review, N times | At publish, once |
| Bank exhaustion risk | Higher (small pools) | Lower (shared pools) |

---

## Real trade-offs to design through

1. **"Intelligently group" requires a clustering call.** One LLM call
   per HW publish. Cheap, but it's a new dependency. Alternative:
   simpler heuristic (same source doc + keyword overlap) — cheaper but
   dumber. Probably worth doing the LLM cluster.

2. **Data model change.** Today variations link to one parent via
   `parent_question_id`. Group-shared variations need either:
   - **(a)** New `question_group` table; primaries belong to a group,
     variations point at the group. Cleaner.
   - **(b)** Variations gain many-to-many parents. Less migration but
     fuzzier semantics.
   - Lean **(a)**.

3. **Student-loop semantics.** "Practice similar of HW Q3" today pulls
   Q3's children. With groups, it pulls from Q3's group pool — which
   may include variations originally seeded thinking about Q1 or Q2.
   Mostly a feature (broader pool), but bad clustering = student gets
   off-topic practice.

4. **Group-of-one fallback.** A HW with 8 totally unique questions
   that don't cluster ends up with 8 single-question groups — same as
   today, just delayed to publish. Grouping must be conservative and
   the UI must handle "no clusters worth grouping" gracefully.

5. **Misclustering recovery.** Teacher needs an obvious way to override
   the proposed groups before generation fires. Otherwise bad cluster
   = wasted compute + bad variations.

6. **Edit-after-publish.** What if a teacher unpublishes, edits a
   question, and republishes? Re-cluster? Re-use existing groups? Edge
   case to think through.

---

## Skeleton flow

```
Teacher hits Publish on draft HW
   │
   ▼
┌──────────────────────────────────────────────┐
│  Generate practice variations for this HW?  │
│  • Smart group (recommended)                 │
│  • Per question                              │
│  • Skip — students will have nothing         │
└─────┬────────────────────────────────────────┘
      │ Smart group
      ▼
[clustering job runs in background, ~5–10s]
      │
      ▼
┌──────────────────────────────────────────────┐
│  Proposed groups                             │
│                                              │
│  Group 1: Factoring quadratics  [3 problems]│
│    Q1, Q3, Q7                                │
│  Group 2: Linear systems        [2 problems]│
│    Q2, Q5                                    │
│  Group 3: Word problems / rates [3 problems]│
│    Q4, Q6, Q8                                │
│                                              │
│  [Drag to regroup]  [+ Custom group]        │
│  [Generate variations →]                     │
└─────┬────────────────────────────────────────┘
      │
      ▼
For each group: generate-similar with group seed
Variations land in pending, linked to group
      │
      ▼
Teacher hits review queue → existing Flow B modal
      │
      ▼
Approved variations populate the group pool
HW publishes alongside (or after teacher confirms)
```

---

## What needs to change in the existing redesign

Nothing is wasted. The current per-question nudge becomes the
**fallback** under "Per question" mode. The Flow B variation review
modal works unchanged — it just walks through variations grouped by
parent or group, doesn't care which.

Backend:
- New `question_groups` table (or whatever shape we land on)
- New clustering endpoint (single LLM call, returns proposed groups)
- `generate-similar` extended to accept a group of seed questions, not
  just one
- Variations gain optional `question_group_id` (nullable for legacy
  per-question variations)

Frontend:
- Publish flow gets a pre-publish modal asking the question
- New cluster preview UI for editing proposed groups
- ApprovedView's variation badge becomes group-aware (shows "12
  variations · shared with 3 problems" when group-backed)

---

## Build only after

- Current question-bank redesign ships and lands real teacher usage
- We have data on what HWs look like in practice (size, concept
  diversity, how often the per-question approach feels redundant)
- Test / Mock Exam flows are designed (they may share the grouping
  concept)

---

## Open questions to revisit

- LLM cost per cluster call vs raw teacher time saved — is it net
  positive even at 10x scale?
- Does the clustering need to be teacher-confirmable, or can we
  auto-fire and let them undo?
- What happens to per-question variations from the v1 flow when this
  ships? Migrate? Leave as-is?
- Can groups span multiple homeworks, or are they HW-scoped? (HW-scoped
  is simpler; cross-HW grouping is the natural next step after that)
