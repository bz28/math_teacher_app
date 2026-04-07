# Question Bank Workshop v2 — Chat-First Editing

> **Status:** Approved, in progress
> **Branch:** `feat/school-phase-4-question-bank`
> **Replaces:** the v1 "Revise with AI" textarea + 1-shot regenerate flow

---

## The big idea

The bank's editing surface becomes a **two-panel modal**: question/solution artifact on the left, persistent **chat workshop** on the right. Teachers iterate with Claude in conversation, see proposals previewed in the artifact, and explicitly Accept or Discard. Nothing writes to the database until Accept.

This is one of the most-used surfaces in the school product. It needs to feel collaborative, not destructive.

---

## Locked design decisions

| Decision | Choice |
|---|---|
| Primary AI interface | Persistent chat sidebar |
| Manual editing | Click-to-edit on every field, with a hover pencil affordance |
| Preview before commit | Mandatory — proposals never write to DB until Accept |
| Chat input context | Always full question + solution in (Claude needs both for consistency) |
| Chat output scope | Proposals contain only the fields that actually changed (`null` for unchanged) |
| Stacked proposals | New proposal **replaces** the previous one in preview |
| Accept memory | Accepted state becomes the new "current" — subsequent chat messages see it |
| Chat persistence | Stored in a JSON column on `question_bank_items`, survives modal close |
| Soft cap | 20 messages per question (banner when reached, AI still responds) |
| Reset | "Clear chat & start over" link in the chat sidebar |
| Undo | 30-second undo via existing `previous_*` snapshot — works for manual + AI accepts |
| Mobile | Two-panel collapses to a bottom-drawer chat |
| Just-asking-questions | Claude can return `proposal: null` — chat is ALSO a sanity-check tool |

---

## What it looks like

### Desktop layout

```
┌────────────────────────────────────────────────────────────────┐
│  Question                              [pending]    ↶ Undo  ✕  │
├──────────────────────────────────────┬─────────────────────────┤
│                                       │  💬 Workshop            │
│  ┌─ Question ──────────────────┐ ✎  │  ─────────             │
│  │ Solve x² + 5x + 6 = 0       │    │                         │
│  └─────────────────────────────┘    │  AI: Hi! I generated   │
│                                       │  this from chapter5.    │
│  Solution                            │  png. Want me to        │
│  ┌─ ① Factor the quadratic ───┐ ✎ │  change anything?       │
│  │ ──                          │    │                         │
│  │ x² + 5x + 6 factors as      │    │  ─────                  │
│  │ (x+2)(x+3)                  │    │                         │
│  └─────────────────────────────┘    │  You: smaller numbers   │
│                                       │                         │
│  ┌─ ② Set each factor to zero ┐ ✎ │  AI: Sure, here's a    │
│  │ ──                          │    │  version with smaller   │
│  │ x + 2 = 0 or x + 3 = 0      │    │  numbers.               │
│  └─────────────────────────────┘    │  [Preview shown ←]      │
│                                       │  [✓ Accept] [✕ Discard]│
│  ┌─ ③ Solve ───────────────────┐ ✎ │                         │
│  │ ──                          │    │  ─────────────────      │
│  │ x = -2 or x = -3            │    │                         │
│  └─────────────────────────────┘    │  ┌─────────────────┐   │
│                                       │  │ Type a message…│   │
│  ┌─ Final answer ──────────────┐ ✎ │  └─────────────────┘   │
│  │ x = -2 or x = -3            │    │              [Send]    │
│  └─────────────────────────────┘    │                         │
│                                       │  Clear chat            │
│                                       │  3/20 messages         │
├──────────────────────────────────────┴─────────────────────────┤
│  [✓ Approve]  [✕ Reject]                              [🗑]    │
└────────────────────────────────────────────────────────────────┘
```

### Mobile layout
- Left panel takes the full screen
- Floating "💬 Workshop" button bottom-right
- Tap → bottom drawer ~70% screen height
- When a proposal arrives, drawer auto-closes and a banner appears at the bottom of the artifact: `Proposal ready · [✓ Accept] [✕ Discard]`

---

## How the chat actually works

### Welcome message (free, no AI call)
First open of a question that has no chat history → render a static message:
> "Hi! This question was generated from {source_doc_name(s)}. Ask me anything — I can rewrite the question, redo the solution, change the difficulty, turn it into a word problem, or just answer questions about it."

Plus 3 suggestion chips: "Make it harder" / "Add a step" / "Rewrite as a word problem"

### Sending a message
1. Teacher types → POST `/teacher/question-bank/{id}/chat` with `{ message }`
2. Backend appends teacher message to `chat_messages` array
3. Backend builds the prompt:
   - **System**: workshop role, full schema rules, examples of `proposal: null` vs `proposal: {...}`
   - **User context**: current question + current solution + current final answer + the source doc image(s)
   - **Conversation**: last N (≤20) chat messages
4. Calls Claude Vision with `BANK_CHAT_REPLY_SCHEMA`
5. Claude responds with `{ reply, proposal? }`
6. Backend appends AI message to `chat_messages` (with the proposal attached as a sub-object)
7. Returns updated chat thread

### When the AI returns a proposal
- The chat message renders the AI's reply text
- Below it: a "Preview shown ←" tag pointing left + Accept/Discard buttons
- The left panel highlights the changed sections (blue left border on changed cards, blue background pulse on the question if changed)
- Unchanged sections stay normal

### Accept
1. POST `/teacher/question-bank/{id}/chat/accept` with `{ message_index }`
2. Backend loads the message at that index, extracts the proposal
3. `snapshot_history(item)` — copies current state to `previous_*`
4. Applies only the non-null fields from the proposal
5. Marks the chat message as `accepted: true`
6. Returns updated item + chat
7. Frontend: highlights drop, undo affordance appears in header for 30s

### Discard
1. POST `/teacher/question-bank/{id}/chat/discard` with `{ message_index }`
2. Backend just marks the chat message as `discarded: true` — no DB content change
3. Frontend reverts the left panel to live state, chat shows "✕ Discarded"

### Stacked proposals
If a new proposal arrives while a previous one is unaccepted:
- The new proposal replaces the preview
- Previous proposals in the chat stay as history but lose their accept/discard buttons (greyed out)

### Manual edit collision
If the teacher manually click-to-edits a field while a proposal is pending → the proposal is auto-discarded (toast: "Pending proposal discarded — your manual edit is now live")

### Clear chat
- "Clear chat" link at the bottom of the sidebar
- Confirms once ("This wipes the conversation. Question and solution are unchanged.")
- POST `/teacher/question-bank/{id}/chat/clear` → empties the array
- Welcome message reappears

### Soft cap
- When `chat_messages.length >= 20`: a banner appears in the chat ("You've sent a lot — consider clearing or regenerating from scratch") but messages still go through
- We send only the last 20 messages to Claude regardless

---

## Backend changes

### Migration
- Add `chat_messages` JSON column to `question_bank_items`, default `[]`

### New schema
`BANK_CHAT_REPLY_SCHEMA` in `llm_schemas.py`:
```
{
  "name": "return_chat_reply",
  "input_schema": {
    "reply": "string",                      // conversational response
    "proposal": {                           // null when just answering questions
      "question": "string | null",
      "solution_steps": [{title, description}] | "null",
      "final_answer": "string | null"
    } | "null"
  }
}
```

### New module: `api/core/question_bank_chat.py`
- `chat_with_bank_item(db, item, course, teacher_message, user_id)` — appends teacher msg, builds prompt, calls Claude, appends AI msg, commits
- System prompt template explains: workshop role, when to propose vs just answer, scoped output rules, format

### New routes: `api/routes/teacher_question_bank.py`
- `POST /question-bank/{id}/chat` — body `{ message: string }` → returns updated chat thread
- `POST /question-bank/{id}/chat/accept` — body `{ message_index: int }` → snapshots + applies + returns updated item
- `POST /question-bank/{id}/chat/discard` — body `{ message_index: int }` → marks discarded, no content change
- `POST /question-bank/{id}/chat/clear` → wipes chat_messages

### Deprecated (kept for now)
- `POST /question-bank/{id}/regenerate` — frontend stops calling it, leave the endpoint until cleanup pass

---

## Frontend changes

### New components
- `QuestionDetailModal` — two-panel layout, owns chat state + pending proposal state
- `ArtifactPanel` — left side, renders question + solution + final answer with highlighting
- `SolutionStepCard` — numbered card with hover pencil + click-to-edit
- `FinalAnswerCallout` — tinted callout box for the final answer
- `ChatPanel` — message thread + input + suggestion chips + clear link + message counter
- `ChatMessage` — single message with role badge, body, and proposal block when present
- `ProposalActions` — Accept / Discard buttons under a proposal message

### State machine inside the modal
- `chatMessages: ChatMessage[]` (loaded from item, kept in sync via API responses)
- `pendingProposal: { messageIndex, fields } | null` — derived from the latest non-discarded/non-accepted proposal in the chat
- `isThinking: boolean` — true while a chat message is in flight
- Manual edit state stays per-field as today

### Highlight rules
- A field is "changed" if `pendingProposal.fields[fieldName] !== null && !== current`
- Changed cards get a blue left border + subtle background tint
- Highlights drop on Accept, Discard, or modal close

### Undo
Same `↶ Undo last change` affordance in the modal header. Visible when `item.has_previous_version === true`. Auto-hides after 30s. Calls existing `revertBankItem`.

---

## Edge cases

| Case | Handling |
|---|---|
| Network error mid-chat | Inline retry button, message draft preserved |
| Claude returns malformed JSON | Tool use prevents it; fallback shows "AI response error, try again" message in chat (not committed to history) |
| Long chat hits 20 cap | Banner, messages still go through, only last 20 sent to Claude |
| Teacher closes modal mid-conversation | Chat persisted, reopens at last state |
| Two devices editing same item | Last write wins (no locking in v2) |
| Manual edit while proposal pending | Auto-discard pending proposal, toast warning |
| Approve while proposal pending | Approves the **live** state, not the proposal. Proposal stays pending. |
| Source docs deleted between regens | Empty image list, Claude generates from text only, may be lower quality — log a warning |

---

## What ships in this PR

**Commit A — Backend (chat foundation)**
- Migration: `chat_messages` column
- `BANK_CHAT_REPLY_SCHEMA` in llm_schemas
- `question_bank_chat.py` orchestrator
- 4 new routes: `/chat`, `/chat/accept`, `/chat/discard`, `/chat/clear`
- Updated `_serialize_item` to include `chat_messages`
- Old `/regenerate` endpoint stays but unused

**Commit B — Frontend (the rework)**
- Two-panel `QuestionDetailModal`
- Solution visual rework (numbered cards, pencil affordances)
- `ChatPanel` with full conversation flow
- Preview highlighting + Accept/Discard
- Mobile drawer
- API client methods for the 4 new endpoints

---

## Out of scope (future)

- Streaming responses as Claude types
- Multi-turn refinement that builds on prior proposals (we replace instead)
- Per-section regenerate ("just step 2") via UI granularity (the chat handles this via NL)
- Side-by-side diff view (highlighting is enough for v2)
- Smart welcome message that summarizes the source doc (static for v2)
- Collaboration / locking when two teachers edit the same item

---

## Risk: token cost

Chat messages use more tokens than single regenerate calls. Mitigations:
- 20-message soft cap
- Last-20-only context window
- `proposal: null` mode means asking questions doesn't trigger a generate
- Long-term: consider Haiku for short conversational replies, only Sonnet when a proposal is needed
