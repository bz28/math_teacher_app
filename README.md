# Math Teacher App

An AI-powered math tutoring app that teaches students how to solve problems step-by-step — not by giving them answers, but by guiding them through the thinking process. Built for schools and independent learners.

Students type a math problem or enter a word problem. The app breaks it down into steps, asks the student to attempt each step, and provides hints and explanations when they get stuck. It never gives away the answer. The student always has to do the final thinking themselves.

---

## Table of Contents

- [How the App Works (The Tutoring Loop)](#how-the-app-works-the-tutoring-loop)
- [How Problems Get Into the App](#how-problems-get-into-the-app)
- [The Math Engine (SymPy + Claude Hybrid)](#the-math-engine-sympy--claude-hybrid)
- [The AI Tutor (Claude LLM)](#the-ai-tutor-claude-llm)
- [Anti-Cheating and Integrity](#anti-cheating-and-integrity)
- [Hint System](#hint-system)
- [Explain-Back System](#explain-back-system)
- [Adaptive Difficulty](#adaptive-difficulty)
- [Network Resilience](#network-resilience)
- [Per-User Rate Limits](#per-user-rate-limits)
- [Teacher Features](#teacher-features)
- [Student Progress Tracking](#student-progress-tracking)
- [Architecture Overview](#architecture-overview)
- [Security and Privacy](#security-and-privacy)
- [Math Coverage (v1)](#math-coverage-v1)
- [Future Roadmap](#future-roadmap)

---

## How the App Works (The Tutoring Loop)

This is the core of the entire app. Every tutoring session follows this loop:

1. **Student inputs a problem** — by typing a math expression or entering a word problem.
2. **The app parses the problem** into a structured math representation (for word problems, Claude translates the natural language into an equation first) and generates an ordered list of solution steps.
3. **The app asks: "What would you do first?"** — the student has to propose the first step themselves.
4. **The app evaluates the student's response** against the correct step. Three things can happen:

   - **Correct** — The student either advances to the next step, or (about 30% of the time, randomly) gets asked to explain their reasoning in their own words before moving on.
   - **Wrong** — The app explains what went wrong and offers a hint. Hints get progressively more specific (vague → detailed), but never give away the full answer. After 5 failed attempts, the step is broken down into smaller sub-steps.
   - **Skipped steps** — If the student jumps straight to the answer without showing intermediate work, the app catches this and says: "That's the right answer, but walk me through HOW you got there." The student has to show their work.

5. **This repeats for every step** until the problem is fully solved.
6. **Session complete** — The student sees a summary of their session.

The key design principle: the app is a tutor, not an answer key. It will guide, hint, explain, and scaffold — but the student always has to do the thinking.

---

## How Problems Get Into the App

### Text Input
The student types the math problem using a specialized math keyboard that supports fractions, exponents, parentheses, and other mathematical notation. The typed input is sent to the backend, parsed by SymPy (a Python math library) into a structured representation, and displayed back to the student as properly formatted math using LaTeX rendering (rendered via KaTeX in a WebView on mobile).

If the input can't be parsed (e.g., gibberish or unsupported notation), the app tells the student and asks them to try again.

### Word Problems
Students can also enter word problems in plain English (e.g., "A store sells apples for $2 each. If Maria buys some apples and pays $14, how many apples did she buy?"). For word problems, Claude parses the natural language into a mathematical equation, then SymPy takes over for verification and step generation. This is included in v1 because students rarely encounter naked equations — the translation from a real-world context to math is where most students struggle.

### Photo Input (Future — v2)
Photo-based input using OCR (camera capture → Mathpix API → LaTeX → structured math) is planned for a future version but is not included in the v1 launch.

---

## The Math Engine (SymPy + Claude Hybrid)

This is the most technically interesting part of the app and was the highest-risk component to build.

### The Problem
SymPy (a Python computer algebra system) can solve math problems and verify answers, but it only gives you the final answer — not the step-by-step process a student would follow. If you ask SymPy to solve `2x + 6 = 12`, it tells you `x = 3`. It doesn't say "first subtract 6 from both sides, then divide both sides by 2."

### The Solution: Hybrid Approach
The app uses both SymPy and Claude (an AI language model) together:

- **Claude generates the step-by-step breakdown.** Given a problem, Claude produces a pedagogically sensible sequence of steps a student should follow — the kind of steps a good math teacher would walk through on a whiteboard.
- **SymPy verifies the final answer.** After Claude generates all the steps, SymPy independently solves the problem and checks that Claude's final answer matches. For v1's algebra-level math, a correct final answer strongly implies correct intermediate steps. This avoids the fragility of trying to parse each of Claude's intermediate expressions back into SymPy for per-step verification.
- **If the final answer doesn't match**, the system feeds SymPy's correct answer back to Claude and asks it to regenerate (up to 3 retries). If retries are exhausted, the system falls back to a simpler decomposition with fewer steps.
- **Few-shot caching by problem structure.** The cache key is the problem type and structure (e.g., "linear equation, ax+b=c"). The cache stores real decompositions of previously solved problems of that structure, which are used as few-shot examples in Claude's prompt — not as templates to instantiate. When a new problem comes in, the cached example is included in the prompt ("Here's how we broke down a similar problem: [cached example]. Now decompose this one: ..."). Claude handles the translation naturally. New outputs are cached alongside existing examples. This avoids the fragility of template instantiation (Claude doesn't generate structurally identical steps for different numbers) while improving quality, consistency, and retry rates.

Each step in the generated sequence contains:
- A description of what's happening (e.g., "Subtract 6 from both sides")
- The operation being performed
- The state before the step (e.g., `2x + 6 = 12`)
- The state after the step (e.g., `2x = 6`)

### Other Math Engine Capabilities
- **Expression equivalence** — The engine knows that `2/4` and `1/2` are the same thing, and that `x + 1` and `1 + x` are equivalent. Students don't get marked wrong for correct answers in different forms.
- **Answer verification** — Given a problem and a proposed answer, the engine can confirm whether it's correct.
- **Similar problem generation** — The engine can generate a new problem with the same structure and difficulty but different numbers. This is used to confirm the student actually understands a concept (not just memorized one problem).

---

## The AI Tutor (Claude LLM)

The app uses Claude (Anthropic's language model) as the tutoring intelligence layer. It runs in three distinct modes, each with its own specialized system prompt:

### Evaluator Mode
Takes the correct step (from SymPy) and the student's response, then determines if the student is right, wrong, or partially right. This is more nuanced than simple string matching — the evaluator handles:
- Correct answer with wrong method (student got the right number but did something mathematically invalid to get there)
- Partially correct responses (right direction but arithmetic errors)
- Equivalent expressions (different forms of the same answer)
- Skipped steps (answer is correct but the student jumped ahead)

### Explainer Mode
When a student gets something wrong, the explainer generates a clear, grade-level-appropriate explanation of what went wrong and what the correct approach is. A 5th grader gets a different explanation than a 9th grader for the same error. Explanations are streamed word-by-word to the student in real-time so there's no awkward waiting.

### Prober Mode
When the student is asked to "explain in your own words," the prober assesses whether the explanation shows genuine understanding. It uses a rubric:
- **Clear understanding** — The student identifies the operation, explains WHY it applies, and states the result. Example: "I subtracted 3 from both sides to isolate x."
- **Partial understanding** — The student describes WHAT happened but not WHY. Example: "I moved the 3 to the other side."
- **No understanding** — The explanation contradicts the math or is incoherent.

Based on this assessment, the app either advances the student, asks a targeted follow-up question, or re-explains the concept in a different way.

### Session Context
Every time Claude is called, it receives the recent conversation history (the last N exchanges with the student). This means the tutor can say things like "You made the same sign error again — remember what we said about distributing negatives?" It builds on previous explanations rather than treating every response in isolation.

### Streaming
All Claude responses are streamed to the student's device in real-time. Instead of waiting 1-3 seconds for a complete response, students see the text appearing word-by-word, like a person typing. This makes the interaction feel responsive and natural.

### Retry & Resilience
All LLM calls use exponential backoff (3 retries) with a 10-second timeout per call. A circuit breaker pattern monitors error rates — if Claude errors exceed a threshold, the system fails fast for a cooldown period rather than queuing up requests that will also fail.

### Cost Tracking & Alerting
Every LLM call is logged with prompt hash, full response, latency, input/output token count, and estimated cost, tagged with `session_id` and `user_id`. This enables debugging ("why did the tutor say X?"), cost monitoring, and per-school usage reports. A global daily cost circuit breaker triggers if Claude API spend exceeds a configurable threshold, optionally degrading non-essential calls (like explain-back) to protect costs.

---

## Anti-Cheating and Integrity

The app is designed to make cheating harder than actually learning. There's no single "anti-cheat system" — it's a set of overlapping mechanisms:

### Step-Size Enforcement
This is the primary defense. The math engine knows every intermediate step. If a student skips from the problem statement to the final answer (which they might have gotten from a calculator or another app), the system rejects it: "That's the right answer, but walk me through HOW you got there." The student must show each intermediate step.

The v1 approach uses a simple "step distance" heuristic: each student response should represent at most one mathematical operation from the current state. If the student's answer matches a step 2+ ahead in the solution, the system rejects it and asks for intermediate work. This doesn't attempt to prove general mathematical reachability — that's a research problem. For v1's algebra scope, the "one operation per step" heuristic covers the vast majority of cases. Edge cases where a student combines two simple operations are handled gracefully by the LLM evaluator, which can accept reasonable combinations with a note like "Good, but let's take it one step at a time."

### Hint Ceiling
The hint system never gives away a complete step. Hints are capped at roughly 80% of the information needed. The student always has to contribute the final piece themselves. Even after exhausting all hints, the student still has to do some thinking.

### Attempt Limits
After 5 failed attempts on a single step, the system doesn't give up — it scaffolds down. The step is broken into smaller sub-steps that are easier to tackle. The student still has to work through them.

### Random Explain-Back on Correct Answers
About 30% of correct answers trigger an "explain this in your own words" prompt. This isn't punishment — it happens randomly on correct answers too. This catches lucky guesses and prevents students from associating the explain-back prompt with failure. Combined with step-size enforcement, this makes brute-force guessing impractical — even if a student gets the right answer by luck, they'll have to explain their reasoning.

---

## Hint System

When a student gets a step wrong, hints are offered progressively:

1. **First hint** — Vague and general. Points the student in the right direction without giving details. ("Think about what operation would help isolate the variable.")
2. **Subsequent hints** — Increasingly specific. Each hint reveals a bit more about the approach.
3. **Final hint** — Gives strong guidance but stops at roughly 80% of the answer. The student must still figure out the last piece. ("You need to subtract 6 from both sides. What do you get?")

Hints never give the complete step. There is a hard ceiling — the student always has to do the final thinking.

After 5 failed attempts at a step (across all hint levels), the system breaks the step into smaller sub-steps rather than revealing the answer. The philosophy is that if a step is too hard, make it smaller — don't give it away.

---

## Explain-Back System

"Explain this in your own words" is one of the most important pedagogical tools in the app. It's triggered in two situations:

1. **After a hint sequence** — If the student needed hints to get a step right, they're asked to explain the step in their own words before advancing. This confirms they actually understood the help they received.
2. **Randomly on correct answers (~30%)** — Even when the student answers correctly on the first try, there's a roughly 30% chance they'll be asked to explain. This catches lucky guesses and reinforces learning.

The explanation is evaluated by Claude's Prober mode:
- **Clear understanding** → Student advances (or gets a similar problem to confirm mastery).
- **Partial understanding** → The app asks a targeted follow-up question to fill the gap.
- **Wrong understanding** → The app re-explains the concept in a different way and loops back.

---

## Adaptive Difficulty

The app tracks mastery per concept (e.g., "solving linear equations," "factoring quadratics") and adjusts difficulty based on performance:

- **High mastery (>80%)** — Harder problems: bigger numbers, more steps, compound operations.
- **Low mastery (<40%)** — Easier problems: simpler numbers, fewer steps, problems broken into sub-problems.
- **Medium mastery** — Stay at the current level.

Mastery scores update after every session and after similar-problem confirmations. This means the difficulty naturally ramps up as the student learns and ramps down when they're struggling.

---

## Network Resilience

The mobile app is built for real-world conditions — students on school buses with spotty WiFi, or in classrooms where connections drop. The app handles this gracefully:

- **Optimistic UI** — When the student submits an answer, their input appears immediately in the conversation. The app shows a "thinking" state while waiting for the server response, rather than blocking the entire UI.
- **Retry with exponential backoff** — If a request fails (timeout, network error), the app automatically retries with increasing delays rather than showing an error screen immediately.
- **Graceful degradation** — If the connection drops mid-session, the app queues the request and shows a "reconnecting..." message. When the connection returns, it sends the queued request automatically. No crashes, no lost work.

---

## Per-User Rate Limits

To control Claude API costs, the app enforces per-user daily request caps. Each user has a maximum number of sessions and requests they can make per day. These limits are configurable per tier (free users vs. school-licensed users), so schools that pay for the service get higher limits. When a user hits their cap, they get a clear message explaining they've reached their daily limit.

Token usage and cost data is aggregated into per-school usage reports, so schools can understand and budget for their usage.

---

## Teacher Features

### Teacher Accounts
Teachers have a separate role from students. They can create classes and generate join codes that students use to enroll.

### Assignment Mode
Teachers can assign specific problem types or topics to their class. Students see assigned work in the app alongside self-directed practice.

### Per-Student Visibility
For each student, teachers can see:
- Which problems were attempted and completed
- How many hints were used per step
- How many attempts per step
- Whether explain-back was triggered and whether the student passed

### Hint Aggressiveness Config
Teachers can adjust tutoring parameters per class or per student:
- **Attempt limits** — How many attempts before the system scaffolds down (default: 5). Some students benefit from more struggle time; others need faster support.
- **Hint ceiling** — The percentage of a step that hints can reveal (default: 80%).

This gives teachers control over the tutoring style without requiring them to understand the technical details.

### Class Overview Dashboard
Aggregate statistics across the whole class:
- Common problem areas (which topics are students struggling with most)
- Average attempts per step
- Topic mastery distribution (how many students have mastered each concept)

### Web-Only Dashboard
The teacher dashboard is a separate React web application, not part of the mobile app. Teachers use laptops, not phones, so a web interface is faster to build and more practical to use. The mobile app remains student-only in v1.

---

## Student Progress Tracking

The app stores detailed session history for every student:

- **Problem history** — Every problem attempted, with full session data (steps completed, hints used, attempts per step, explain-back results).
- **Mastery scores** — Per-concept mastery percentages that update after every session and similar-problem confirmation.

Students can view their own history (past problems and how they solved them) and progress (mastery by topic).

---

## Architecture Overview

```
React Native (iOS/Android)          React Web (Teacher Dashboard)
        |                                    |
        +------ HTTPS API (SSE streaming) ---+
                        |
              FastAPI (Python Backend)
             /          |            \
          SymPy      Claude API    PostgreSQL
         (math)     (AI tutor)     (data)
```

### Why This Stack

- **React Native (Expo)** — One codebase for both iOS and Android. Student-facing only.
- **React Web** — Teacher dashboard. Teachers use laptops, so a web app is more practical.
- **FastAPI (Python)** — Python was chosen specifically because SymPy is a Python library. Keeping SymPy in-process (no separate microservice) reduces latency and complexity.
- **SymPy** — The math correctness engine. Handles parsing, verification, and equivalence checking.
- **Claude API** — The tutoring intelligence. Generates step-by-step breakdowns, evaluates student responses, explains concepts, and assesses understanding. Also parses word problems into equations.
- **PostgreSQL** — Stores users, sessions, progress data, and mastery scores. Student emails are encrypted at rest.
- **Alembic** — Database migration tool. Schema evolves across multiple PRs, so migration tooling is in place from day one.
- **SSE (Server-Sent Events)** — Used for streaming LLM responses from the backend to the mobile app in real-time.
- **KaTeX via WebView** — Renders LaTeX math notation on mobile. Chosen over `react-native-math-view` for better cross-platform reliability. WebView spin-up latency (200-500ms on older devices) is mitigated by pre-warming on app launch.
- **API Versioning** — All routes are prefixed with `/v1/` from day one. The app is sold to schools — once they integrate, the API can't break. Cheap insurance.
- **Structured Logging** — JSON structured logging with correlation IDs per session/request. Request tracing middleware tags every log line with a `request_id`, which is essential for debugging LLM-dependent flows ("why did the tutor say X?").
- **Mobile State Management** — Zustand or React Context + useReducer (not Redux — overkill for this app). Tutoring sessions have complex state (current step, history, streaming responses, network status, retry queues) so this decision is made upfront.
- **Database Connection Pooling** — SQLAlchemy async engine with connection pool configuration, important under load.

### Key Design Decision: No Secrets on Mobile
The mobile app never talks directly to Claude or any external API. All API keys live on the backend server. The mobile app only talks to the FastAPI backend. This means:
- API keys can't be extracted from the mobile app
- All requests go through the backend where they can be authenticated, rate-limited, and logged
- Third-party services never see student identity information

---

## Security and Privacy

### Regulatory Compliance
The app handles student data and targets schools, which makes FERPA and COPPA compliance mandatory:

- **FERPA** — The app operates as a "school official" under contract with schools. Schools own their data. The app supports data export and deletion on school request.
- **COPPA** — Students under 13 require consent. Schools can provide consent on behalf of parents under the FERPA exception. This consent flow is documented.
- **Data Processing Agreement (DPA)** — Available for school contracts (standard in edtech).
- **Privacy policy** — Clear language on what is collected, how it's used, and what goes to third parties.

### What Third Parties See
- **Claude API (Anthropic)** receives student text responses and math expressions, but never student names, emails, or other identifying info. Anthropic does not train on API inputs.
- **Mathpix API** (v2 only — not used in v1). When added, it will receive photos of math problems. Images will be preprocessed to strip metadata and crop to the math region, preventing accidental leakage of student names from worksheet headers.
- No third party receives student identity. All calls are keyed to the app's API key, not student accounts.

### Application Security
- **Authentication** — Passwords hashed with bcrypt. JWT tokens with short expiry plus refresh tokens with rotation and family detection (reuse of an old refresh token invalidates the entire token family, preventing replay attacks). Account lockout after 5 failed login attempts.
- **API protection** — HTTPS only, security headers (CORS, CSP, HSTS), rate limiting per user, request size limits (10MB max for image uploads), input sanitization on all endpoints.
- **Database** — Student emails encrypted at rest. All queries use parameterized statements via SQLAlchemy (prevents SQL injection). Postgres connections use TLS.
- **Mobile** — No secrets on device. Tokens stored in secure device storage (expo-secure-store).
- **LLM prompt injection defense** — Students could type adversarial input instead of math. The system uses strong system prompts, validates LLM output against expected schemas, and filters responses before returning them to the client.
- **Data retention** — Session data retained for the school year, then deleted. Schools can request immediate data deletion at any time.

---

## Math Coverage (v1)

The first version of the app supports:
- **Arithmetic** — Addition, subtraction, multiplication, division with integers and fractions
- **Linear equations** — Single-variable equations (e.g., `2x + 6 = 12`)
- **Quadratic equations** — Standard quadratics (e.g., `x² + 5x + 6 = 0`)
- **Algebraic expressions** — Simplify, factor, and expand expressions
- **Word problems** — Translating natural language contexts into equations (e.g., "A store sells apples for $2 each..."). Claude parses the word problem into a mathematical equation, then the standard tutoring loop takes over.

Word problems are included because students rarely encounter naked equations in school. The translation from a real-world context to math is where most students struggle, and it's a critical skill. This scope covers the most common math tutoring needs for the target school market.

---

## Future Roadmap

Features planned for future versions:
- Photo/OCR input (camera capture + Mathpix API for handwritten and printed math recognition)
- Calculus and trigonometry support
- Teacher-authored problems (teachers input their own problems, paste from worksheets, create custom problem sets)
- Standards alignment (tag problems and mastery tracking to Common Core / state standards for admin buy-in and curriculum alignment)
- Full teacher dashboard with exportable progress reports (for parent conferences, IEP meetings, admin reporting) and assignment grading integration
- Learn mode (built-in curriculum and problem sets by topic and grade level)
- Integrity flags (track suspicious student patterns like brute-force guessing for teacher dashboard visibility — v1's step-size enforcement + random explain-back already make gaming impractical)
- School SSO (Google, Clever, ClassLink)
- Multi-language support (UI and explanations)
- Offline mode with queued LLM calls
- Accessibility features (text-to-speech, screen reader, colorblind themes)
- Geometry and proofs with visual canvas
- Graphing and interactive function visualization
