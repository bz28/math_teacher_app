# App Store Listing — Veradic (Student Learning, iOS)

Everything that gets pasted into App Store Connect for the v1.0 student-learning launch. Organized by the exact form fields in ASC so nothing is missed on submission day.

---

## Identity

| Field | Value |
|---|---|
| App Name (30 chars) | `Veradic: Math Tutor AI` (22 chars) |
| Subtitle (30 chars) | `Solve, Learn & Practice Math` (28 chars) |
| Bundle ID | `com.veradicai.app` |
| SKU | `veradic-ios-001` |
| Primary Language | English (U.S.) |

Name is brand-first then keyword. Subtitle fills three high-volume verbs that aren't in the name. Both are indexed separately by Apple — do not repeat words across them.

## Category

| Field | Value |
|---|---|
| Primary Category | Education |
| Secondary Category | Reference |

Reference is less saturated than Education and improves "Top in Reference" surfacing. Do not pick Productivity — it dilutes parent/student intent.

## Pricing & Availability

| Field | Value |
|---|---|
| Price Tier | Free (with In-App Purchase) |
| Availability | All territories |

## In-App Purchases

Configured via RevenueCat. Product IDs must be created in ASC before first build can be submitted for review.

| Product ID | Reference Name | Type | Duration | Price | Intro |
|---|---|---|---|---|---|
| `veradic_pro_annual` | Veradic Pro (Annual) | Auto-Renewable Subscription | 1 year | $79.99 | 3-day free trial |
| `veradic_pro_weekly` | Veradic Pro (Weekly) | Auto-Renewable Subscription | 1 week | $2.99 | — |

Both belong to the **Veradic Pro** subscription group — Apple requires grouping for upgrade/downgrade logic.

## Keywords (100 chars, comma-separated, no spaces)

```
algebra,geometry,homework,photomath,scanner,calculus,chemistry,student,school,gcse,sat,act,study
```

Exactly 97 characters. Do NOT include words already in the name or subtitle (math, tutor, ai, solve, learn, practice) — Apple indexes those separately and you'd waste budget.

**Before submitting:** spend 30 minutes in AppTweak / Sensor Tower or Apple's own search autocomplete verifying volume for each term against competitors (Photomath, Mathway, Symbolab, Khan Academy). Drop any zero-volume term and replace.

## Description (4000 chars max)

```
Veradic is an AI-powered math tutor that walks you through every problem step by step — without just giving you the answer.

Snap a photo of any math problem, and Veradic breaks it into clear, guided steps. Stuck on a step? Ask the built-in AI tutor. Veradic also scans your handwritten work and tells you exactly where you went wrong.

WHAT YOU CAN DO
• Scan printed or handwritten math problems with your camera
• Learn step-by-step with an AI tutor that explains the "why"
• Generate unlimited practice problems from any question
• Take timed mock tests to prepare for real exams
• Upload a photo of your work and get instant feedback on each step
• Resume any session later from your history

SUBJECTS COVERED
• Algebra I & II
• Geometry
• Trigonometry
• Pre-Calculus & Calculus
• Chemistry

BUILT FOR LEARNING, NOT CHEATING
Veradic intentionally hides final answers until you've walked through the solution. The goal is genuine understanding — not quick answers.

VERADIC PRO
Unlock unlimited problem sessions, unlimited scans, unlimited chat with the AI tutor, full session history, and AI-powered work diagnosis. Start with a 3-day free trial.

• Annual: $79.99/year (about $1.54/week)
• Weekly: $2.99/week
• Cancel anytime in your App Store subscription settings

PRIVACY FIRST
Veradic does not sell your data or show ads. Your work and sessions are used only to provide tutoring. Full account deletion is available in-app under Account → Delete Account.

Veradic is designed for students age 13 and older. A classroom edition for teachers and schools is coming soon.

Privacy Policy: https://veradicai.com/privacy
Terms of Service: https://veradicai.com/terms
Support: support@veradicai.com
```

## What's New (Version 1.0)

```
Welcome to Veradic — your AI math tutor. Snap a problem, learn every step, and practice until it clicks.
```

## Promotional Text (170 chars — can be edited without a new build)

```
Snap any math problem and get guided, step-by-step tutoring from an AI that teaches — not just answers. New: work diagnosis catches errors in your handwritten solutions.
```

## URLs

| Field | URL |
|---|---|
| Support URL | `https://veradicai.com/support` |
| Marketing URL | `https://veradicai.com/students` |
| Privacy Policy URL | `https://veradicai.com/privacy` |

**Note:** Marketing URL points at the dedicated student landing page (verified live, HTTP 200) so App Store visitors see the student value prop instead of the teacher pitch.

## Age Rating

Answer these in the ASC Age Rating questionnaire. Expected final rating: **4+**.

| Category | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Prolonged Graphic or Sadistic Realistic Violence | None |
| Profanity or Crude Humor | None |
| Mature/Suggestive Themes | None |
| Horror/Fear Themes | None |
| Medical/Treatment Information | None |
| Alcohol, Tobacco, or Drug Use or References | None |
| Simulated Gambling | None |
| Sexual Content or Nudity | None |
| Graphic Sexual Content and Nudity | None |
| Contests | None |
| Unrestricted Web Access | No |
| Gambling | No |
| User-Generated Content | No (AI-generated; not user-to-user) |
| Made for Kids | No |

"Made for Kids" = No because the in-app age gate enforces 13+. This is consistent with the signup flow implemented in `mobile/src/components/AuthScreen.tsx`.

## Screenshots

Required: 6.7" iPhone (1290×2796) — Apple renders this size for most device classes. 6.5" is optional fallback.

Six panels, each with a large text overlay (4-6 words):

1. **"Snap any math problem"** — hero shot of the camera scan frame over a textbook problem.
2. **"Learn every step"** — Learn-mode session mid-flow with step breakdown and AI chat bubble visible.
3. **"AI catches your mistakes"** — work diagnosis screen showing a student's handwritten work with green/red step markers.
4. **"Unlimited practice"** — practice generator screen with multiple variants shown.
5. **"Timed mock tests"** — mock test screen with timer.
6. **"Resume anywhere"** — history screen showing past sessions.

Design guidelines:
- Text overlay at top third of screen, 60-80pt bold.
- Background matches app's primary color for cohesion across panels.
- Use real content, not Lorem Ipsum.

## App Preview Video (optional, recommended)

15-30s, 1080×1920 portrait, 30fps. Screen recording of: camera scan → learn mode step-through → one AI chat exchange → success confetti. No voiceover — music only (royalty-free).

## Localization

English (U.S.) only for v1. Defer until post-launch.

## ASO Post-Launch Tactics

- **Ratings prompt:** wire `expo-store-review` to fire after a successfully completed session (not on app open). System caps at 3 prompts per 365 days. Implement in a follow-up PR.
- **Product Page Optimization:** once you have ~200 daily impressions, A/B test the first screenshot's headline. Apple provides this as a native feature in ASC.
- **In-app events:** once stable, run "Summer Math Prep" or "SAT Prep Week" in-app events to surface in the Today tab.
- **Keyword rotation:** revisit the keyword field every 30-45 days based on ranking data.
