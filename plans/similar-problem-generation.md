# Similar Problem Generation (Teacher Portal)

> **Status:** Approved, ready to build
> **Scope:** Teacher-facing surface on HW detail. Auto-generation at publish. Inline review. Student side unchanged (already plumbed, just needs content).

---

## Why we're doing this

Today teachers can technically generate practice variations — but only one question at a time, buried behind a button inside the workshop modal. Most never find it. The student-facing Practice Similar / Learn Similar buttons on the HW page already exist but show "No practice available yet" because nobody's making them.

This PR closes that loop with a **per-problem generation model** that's automatic at publish, visible at a glance, and manageable in one place. Non-technical teachers are the primary audience — every decision below flows from that.

---

## Teacher mental model (locked)

One homework → N problems. Each problem has its own practice pool. No groups, no topics, no clustering. The thing the teacher authored is the atomic unit.

---

## Core user flow

**Before this PR:** click a problem → open workshop → hunt for "Make similar" → pick count → repeat N times. Few teachers ever do this.

**After this PR:**
1. Teacher creates HW, adds problems.
2. Clicks Publish. HW publishes instantly. A background job fires to generate 3 practice problems per question (opt-in setting, ON by default).
3. A toast at the top reads: *"✨ Generating practice problems — review them on the Practice page."* The Practice link gets a notification dot with the pending count.
4. First time ever, a one-time banner explains: *"We auto-generate 3 practice problems per question. Change this anytime in Settings."* Dismissible, never shown again.
5. Teacher navigates to the **Practice page** (new route), sees coverage across the whole HW at once, clicks `Review pending` → scrolls to first pending row, auto-expands. Approves / rejects / regenerates inline.
6. Any time later: **Generate missing practice** button refills any pools below target.
7. Students see variations appear the moment they're approved.

**Ergonomic guarantees for non-technical teachers:**
- Zero clicks on the happy path (publish → it just works).
- Every destructive action is reversible (rejected → Restore).
- Vocabulary is **"practice problems"** in UI — "variations" is internal only.
- State visible at a glance; never click to discover coverage.

---

## Architecture decision: URL-suffix, not in-page tabs

Practice lives at `/school/teacher/courses/:id/homework/:hwId/practice` as a sibling route to the existing `/review` page. This is already the established pattern in the codebase.

**Why URL-suffix wins long-term:**
- Deep-linking (teacher can share a URL directly to practice review).
- Each section evolves independently — Stats later is just another route, not a growing tab-state monster.
- No cross-section state management.
- Next.js app router makes it trivial.

The HW detail page gets a small nav strip showing current section + links to Problems / Practice / Review — same visual as tabs, different routing underneath.

---

## Screens

### 1. Teacher settings — defaults (new or extended)

A **Preferences** panel (location: extend existing settings surface, or add a minimal one from the teacher avatar menu if none exists).

Two fields:
- **Auto-generate practice on publish** — toggle (default: ON).
- **Default practice count per problem** — chips `1 / 3 / 5 / 10` + custom input (default: 3).

### 2. Publish — silent + toast

Clicking Publish fires immediately. No blocking modal.
- Toast: *"✨ Generating practice problems — review them on the Practice page."* (only if auto-gen resolves to ON for this HW).
- Practice nav link gets a notification dot showing pending count.
- **First-time only:** dismissible banner across the top explaining what just happened and pointing at settings.

Per-HW override: teacher disables auto-gen for this HW from the Practice page before publishing. Never a blocking modal.

### 3. Practice page (the hero)

Layout top to bottom:

**Coverage header**
- Bold: *"24 practice problems across 8 questions"*
- Muted: *"3 pending your review · 2 problems have no practice yet"*
- Right: per-HW auto-gen toggle + default count (inherits teacher default, overridable).

**Action row (three buttons)**
- `Generate missing practice` — subtext *"brings every question up to 3"*. Fires generate jobs for any problem below target. Disabled when all pools are at target.
- `Review pending (3)` — scrolls to first pending row, auto-expands its pool. Hidden when zero.
- `Preview as student` — opens a modal rendering the student HW view with working Practice/Learn loops for QA.

**Per-problem list (one row per HW problem, in position order)**

Collapsed row:
- Position chip · question preview (1 line, math-rendered) · status line (*5 ready · 2 pending · 1 rejected*, or *0 — no practice yet* in amber) · `Generate more` button · chevron.
- **Staleness badge (amber):** if the HW problem was edited AFTER any variation was created, show *"Edited — existing practice may not match · [Regenerate]"*. Does not auto-delete.

Expanded row — pool split into three groups:
- **Approved (green):** preview, hover actions *Preview · Edit · Reject*.
- **Pending (amber):** preview, actions *Approve · Regenerate · Reject*.
- **Rejected (gray):** collapsed under "Show rejected" toggle, each with *Restore*.

Preview expands inline (full question + answer + solution steps). Edit opens the existing edit modal (verify during implementation scan that it supports variations, not just primaries). Regenerate fires a single new generate-similar job with an optional constraint input (*"make it harder"*, *"different numbers"*) — reused from the existing `GenerateSimilarDialog`.

**Empty state**
If the HW has problems but no variations ever generated: hero card, single CTA: *"Your students don't have any practice yet. [Generate 3 per problem]"*.

**In-flight states**
- Batch job running: top-of-page strip *"Generating 24 practice problems… they'll appear as they're ready."*
- Per-row shimmer when that row's Generate more is running.
- Polling reuses the existing bank-job poller on HW detail.

### 4. Student side — polish only

No new surfaces. One copy tweak on the empty state: *"Practice isn't ready yet — check back soon"* (instead of *"ask your teacher for more"*). Confirm `approved_variation_count` already excludes pending (backend code should be fine; verify).

---

## Flow diagram

```
TEACHER                                       STUDENT
────────                                      ────────
Create HW → add problems
     │
     ▼
Click Publish
HW publishes instantly.
Background: N generate-similar jobs enqueued
     │                                        Opens HW page.
     ▼                                        Per-problem
Toast: "✨ Generating practice…"              Practice/Learn
Practice nav gets notification dot            buttons appear
     │                                        (work only for
     ▼                                        APPROVED variations)
Navigate to Practice page
See coverage for whole HW                            │
     │                                               ▼
     ▼                                        Taps Practice similar
Click Review pending                          → existing loop UI
Scroll to first pending row, auto-expand
Approve / Reject / Regenerate inline
     │
     ▼
Approved → pool → students see immediately
```

---

## Backend changes

1. **Teacher-profile fields:** `auto_generate_practice_on_publish` (bool, default true) + `default_practice_count` (int, default 3). Settings endpoint.
2. **Per-HW override:** same two fields on `Assignment`, nullable (null = inherit). Applied at publish.
3. **Publish hook:** `publishAssignment` resolves the two settings, and if ON, enqueues one `generate-similar` job per approved problem. Publish returns immediately; jobs run async.
4. **Batch top-up endpoint:** accepts assignment_id + target count. Identifies problems below target, fires one generate-similar job per. Returns job IDs for polling.
5. **Staleness flag:** variations already carry a `created_at`. Parent bank items should expose `updated_at`. Frontend compares: any variation created before the parent's last edit = stale row.
6. **Restore-from-rejected:** confirm the bank-status API can move rejected → pending. Add if missing.
7. **Instrumentation audit:** verify `BankConsumption` captures student_id, variation_id, parent_bank_item_id, assignment_id, mode (practice/learn), result, timestamps. Add missing fields now so stats v2 doesn't need a backfill.

No new tables. No grouping. No cross-HW concepts.

---

## Edge cases

1. **LLM fails for some problems in a batch:** per-problem status, "Generation failed — retry" inline. Batch does not fail atomically.
2. **Teacher rejects every variation:** pool shows *0 ready* (amber), prompts `Generate more [3]`.
3. **Teacher unpublishes:** variations stay in pool; students can't see the HW anyway.
4. **Teacher edits HW problem after variations exist:** amber staleness warning on that row. Offer `Regenerate`. Never auto-delete.
5. **HW problem deleted:** soft-archive orphan variations.
6. **"Generate missing practice" while jobs in flight:** skip problems with active jobs, no duplicate queueing.
7. **Rapid Approve/Reject clicks:** optimistic UI, last-write-wins.
8. **Malformed math in a variation:** inline *Render error* badge with Edit affordance; don't crash the pool view.
9. **Tiny / huge HW:** layouts work at both extremes; no virtualization for v1.

---

## Mobile UX

- Coverage header + action row stack vertically on narrow viewports.
- `Generate missing practice` becomes full-width; other buttons stack below.
- Per-problem rows collapse to position + preview + status; tap to expand.
- Hover actions → dropdown menu.
- Preview-as-student → full-screen sheet, not modal.

Student side is already mobile-polished.

---

## Non-goals (explicit defer list)

- Topic/unit-wide grouping or clustering
- Cross-HW or unit-wide practice pools
- Stats dashboards / per-student / per-class views (**instrumentation yes, views no**)
- Student post-submission "keep practicing" flow
- Student post-grade "you missed Q3" practice nudge
- "Practice this whole HW" mixed-mode for students
- Teacher "all practice I've ever created" index
- Keyboard shortcuts for review (clicks only in v1)
- Variation deduplication across HWs

Each is a clean future PR; none blocks this one.

---

## Future follow-ups (noted here so they're not forgotten)

- **LLM cost cap per teacher per month.** Auto-gen at publish can spike usage during back-to-school week. Soft-cap with graceful fallback (*"you've used your auto-gen quota this month — manual generation still works"*). Not v1.
- **Stats views** for per-student and per-class practice usage.
- **Bulk approve** pending variations (risky for non-technical teachers in v1).
- **Keyboard-driven review** (J/K navigate, A/R approve/reject).

---

## Build order (cohesive commits ~150 lines each)

1. Backend: teacher-settings fields + per-HW override + migration.
2. Backend: publish-time auto-gen hook + batch top-up endpoint.
3. Backend: restore-from-rejected (if missing) + instrumentation audit.
4. Frontend: teacher settings additions.
5. Frontend: HW detail nav strip (Problems · Practice · Review links).
6. Frontend: publish-time toast + first-time banner.
7. Frontend: Practice page — coverage header + action row + collapsed rows.
8. Frontend: Practice page — expanded row with approved/pending/rejected pools.
9. Frontend: inline variation actions (approve, reject, regenerate, restore, edit handoff, constraint input).
10. Frontend: staleness badge + polish (empty state, error states, mobile).
11. Student-side empty-state copy tweak + verify approved_variation_count.

Each commit stands alone and is independently testable.

---

## Terminology (locked)

- Teacher UI: **"practice problems"**, **"pool"** (used loosely), **"generate / review / approve / reject / regenerate"**.
- Internal / code / schema: **"variation"**, **"bank item"**, **"parent_question_id"**.
- Student UI: unchanged — *"Practice similar"* / *"Learn similar"*.

---

## Unpublished HW behavior

The Practice page is visible on draft HWs. Teachers can manually generate before publishing. Auto-gen only fires on actual publish. Generating on a draft that later gets deleted → soft-archive orphans.
