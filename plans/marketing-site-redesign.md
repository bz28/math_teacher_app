# Veradic AI — Marketing Site Redesign

Inspired by https://bombon.framer.website/ — big display type, generous whitespace, card-based feature grids, numbered process steps, stat-heavy social proof, scrolling testimonial marquees, warm neutral palette with accent color.

## 1. Goals & Strategy

**Audience priority:**
1. School / district decision makers (admins, dept heads, curriculum directors) — budget owners
2. Teachers — internal champions who forward the site to admins
3. Students and parents — consumer tier, long-tail SEO

**Positioning:** Veradic AI is the AI tutor that *teaches instead of tells.* It does help students reach the answer — it just won't hand it over. Every feature is framed against the implicit ChatGPT-as-homework-helper competitor.

**Must accomplish:**
- Communicate in <5s: AI tutor for schools that guides students (not gives answers), catches cheating, and saves teachers time
- Give a teacher something they'd forward to their principal
- SEO-indexable for high-intent school queries
- Honestly reflect current product capabilities (no overclaiming)
- Feel like Bombon: bold type, whitespace, cards, marquees, friendly-but-credible tone
- Keep Veradic purple but push the overall language to feel more premium

## 2. Information Architecture

**All public routes — preserve every one that exists today.**

| Route | Status | Notes |
|---|---|---|
| `/` | Rebuild | Institutional-first homepage |
| `/teachers` | **Restyle only** | Content frozen. Theme + marquee testimonials only. No copy changes, no section changes, no form changes. |
| `/subjects/math` | Rebuild | New template + SEO content |
| `/subjects/physics` | Rebuild | New template + SEO content |
| `/subjects/chemistry` | Rebuild | New template + SEO content |
| `/students` | **New** | Consumer landing page |
| `/security` | **New** | Trust page |
| `/privacy`, `/terms`, `/support` | Restyle only | Content unchanged (legal) |
| `/login`, `/register`, `/set-password` | Untouched | Auth — out of scope |
| `(app)/*` | Untouched | Authenticated app — out of scope |

Before commit 1, sweep the repo for any other app-store-required pages (account deletion, data safety) and preserve them.

**Navbar (desktop, sticky, translucent-blur):**
- Logo (left)
- Middle: **Teachers**, **For Students**, **Subjects ▾** (Math / Physics / Chemistry), **Security**, **Contact** (mailto)
- Right: **Sign in** (text link), **Book a demo** (primary button → `/teachers#demo-form`), theme toggle

**Navbar (mobile):** hamburger → full-screen overlay, same items stacked, "Book a demo" pinned at bottom.

**Footer (four columns):**
- **Product** — Teachers, Students, Subjects (Math / Physics / Chemistry), Security
- **Company** — About (if added later), Contact
- **Resources** — Support
- **Legal** — Privacy, Terms, Accessibility
- Bottom row: logo, copyright, socials, theme toggle

## 3. Design System Evolution

**Keep:**
- Primary purple `#6C5CE7` / light `#A29BFE`
- Inter font family
- Framer Motion
- Tailwind v4 + CSS variable theming
- Dark mode

**Evolve:**
- **Typography scale** — display type 72–96px desktop / 44px mobile, tight tracking. Body 17–18px.
- **Neutral palette** — warm off-white `#FAFAF7` for surface-alt, deep near-black `#0E0E12` for invert sections, so pages have rhythm
- **Cards** — rounded-2xl, 1px border, no drop shadow, soft hover lift
- **Eyebrow pills** — small all-caps `text-xs tracking-widest` badges ("FOR SCHOOLS", "HOW IT WORKS", "INTEGRITY") used everywhere
- **Stat blocks** — 96px+ numbers with small captions
- **Section rhythm** — alternate `surface / surface-alt / invert` backgrounds
- **Subject accents** — Math purple (brand), Physics blue `#0984E3`, Chemistry green `#00B894`, via single hero gradient + pill only

## 4. Homepage (`/`)

### 4.1 Nav — new shared component

### 4.2 Hero
- Eyebrow: **BUILT FOR CLASSROOMS**
- Headline: **"The AI tutor that teaches, instead of telling."**
- Subhead: *"Veradic walks every student through the thinking — question by question, step by step — until they get there themselves. Built for schools, loved by teachers."*
- CTAs: **Book a demo** (primary → `/teachers#demo-form`), **See how it works** (secondary, anchor scroll)
- Tertiary link: *"Looking for the student app? →"* → `/students`
- Visual (right desktop / below mobile): `[PLACEHOLDER: hero product mockup — student guided steps + teacher dashboard composite]`

### 4.3 Logo strip / trust bar
- "Used by teachers in classrooms across [N] schools"
- Row of 5–8 greyscale logos — `[PLACEHOLDER: school logos]`

### 4.4 "The problem" section
- Eyebrow: **WHY SCHOOLS NEED A NEW KIND OF AI**
- Two-column split
  - Left headline: *"AI chatbots are already in your classrooms. They're just giving away the answers."*
  - Right body: 3 short paragraphs — open chatbots undermine learning; teachers can't tell what's real work; banning doesn't work; schools need an AI on their side

### 4.5 Three pillars
- Eyebrow: **HOW VERADIC WORKS**
- Three feature cards:
  1. **Teaches, doesn't tell.** — "Students don't get a dropped answer. They get guided questions, hints, and step-by-step reasoning that get them to the right answer on their own." Visual: `[PLACEHOLDER: step decomposition screenshot]`
  2. **Catches work that isn't theirs.** — "Our integrity checker asks students follow-up questions about their own submissions. If they didn't do the work, we can tell." Visual: `[PLACEHOLDER: integrity flag UI]`
  3. **Teacher-controlled content.** — "Teachers upload materials, approve AI-generated questions, and build homework from a locked bank. No open photo uploads, no jailbreaks." Visual: `[PLACEHOLDER: question bank approval view]`

### 4.6 Live demo — "Solve a problem with Veradic"
- Eyebrow: **TRY IT YOURSELF**
- Animated/recorded walkthrough of one real problem being solved step-by-step
- `[PLACEHOLDER: real LLM decomposition output for 1 problem in each of math/physics/chemistry — pick the most impressive one]`

### 4.7 Subject strip
- Eyebrow: **SUBJECTS WE SUPPORT**
- Three cards → `/subjects/math`, `/physics`, `/chemistry`
- Each: subject name, one-liner, accent color, "Explore →"
- Below: muted "More subjects coming — tell us what you teach →" (mailto)

### 4.8 For teachers — time savings
- Eyebrow: **FOR TEACHERS**
- Headline: *"Reclaim your evenings."*
- Two-column: left body copy about the teacher workflow (assign → AI tutors every student → see who struggled → grade faster). Right stat grid: `[PLACEHOLDER: real data — hours saved, students reached, completion rate]`
- CTA: *"See everything built for teachers →"* → `/teachers`

### 4.9 For students — short block
- Eyebrow: **FOR STUDENTS**
- Centered single column: *"Stuck on homework? Veradic walks you through it — not past it."*
- CTA: *"Get the student app →"* → `/students`

### 4.10 Integrity & safety strip
- Eyebrow: **BUILT TO BE SAFE IN SCHOOLS**
- Row of 4 compact cards: *Student data privacy*, *Academic integrity checks*, *Content moderation*, *Transparent AI logs*
- Each links to `/security`

### 4.11 Testimonial marquee
- Eyebrow: **WHAT TEACHERS SAY**
- **Two horizontal marquee rows**, scrolling opposite directions (row 1 right→left, row 2 left→right). Pause on hover. Respects `prefers-reduced-motion`.
- Each card: ⭐⭐⭐⭐⭐ + quote + teacher name + role + school
- ~10–12 placeholder quotes shipped from day one, clearly flagged `TODO: replace with real testimonials`. Draft placeholders in §11 below.

### 4.12 Final CTA band
- Full-bleed dark/purple gradient
- **"Bring Veradic to your school."**
- *"Book a 20-minute walkthrough. We'll show you what the integrity checker catches."*
- CTAs: **Book a demo** → `/teachers#demo-form`, **Email us** → mailto

### 4.13 Footer

## 5. `/teachers` — Restyle Only

**CRITICAL: no content changes.** Keep every section, every heading, every sentence, every form field exactly as it is today. Only the visual layer changes:

- Apply new design tokens (colors, typography scale, spacing)
- New card styling (rounded-2xl, border, no shadow)
- Section background rhythm (surface / surface-alt / invert)
- Eyebrow pills above existing headings where they fit naturally
- New button styles
- Dark mode polish
- The demo-request form keeps its existing fields, validation, and submission behavior

**One additive exception:** insert the **scrolling teacher reviews marquee** (same component as homepage §4.11) in a natural position within the existing flow — likely between the features section and the demo form. This is a new visual component, not a content rewrite.

A full content overhaul for `/teachers` will be a separate future plan.

## 6. Subject Pages (`/subjects/math`, `/physics`, `/chemistry`)

One reusable template, three content instances.

### 6.1 Hero (accent-colored gradient)
- Eyebrow: **MATH** / **PHYSICS** / **CHEMISTRY**
- Headline: *"AI that actually teaches [subject]."*
- Subhead: per-subject coverage summary
- CTAs: **Try a problem** (anchor to demo) + **Book a demo** → `/teachers#demo-form`

### 6.2 Topics we cover — pill grid
- **Math:** Pre-Algebra, Algebra I, Algebra II, Geometry, Trigonometry, Pre-Calculus, Calculus, Word Problems, Proofs, Statistics
- **Physics:** Kinematics, Forces, Energy, Momentum, Waves, Electricity, Magnetism, Optics, Modern Physics
- **Chemistry:** Atoms, Bonding, Stoichiometry, Reactions, Equilibrium, Thermodynamics, Organic, Acids & Bases

### 6.3 "See it solve a problem" — live demo
`[PLACEHOLDER: real LLM decomposition — one per subject]`

### 6.4 Subject-specific differentiators (3 cards each)
- **Math:** LaTeX rendering, step-by-step algebraic manipulation, word problem decomposition, proof walkthroughs
- **Physics:** Unit tracking, multi-step problems with diagrams, kinematics walkthroughs
- **Chemistry:** SMILES molecular structure rendering (real feature — `smiles-drawer` is in the codebase), stoichiometry, balancing equations

### 6.5 Why Veradic for [subject] teachers — 3 short reasons

### 6.6 Subject testimonial quote — `[PLACEHOLDER]`

### 6.7 FAQ — 4–6 subject-specific questions

### 6.8 CTA band — "Bring Veradic [subject] to your classroom."

## 7. `/students` — New

Short, simpler, more playful tone.

- Hero: *"Homework help that actually helps."* with app screenshot `[PLACEHOLDER]` and App Store / Google Play badges `[PLACEHOLDER if not live]`
- Three feature cards: *Snap a problem*, *Get guided steps*, *Practice until you get it*
- Subject row (same cards as homepage)
- "Is your teacher using Veradic? Log in here →"
- Short parent-focused FAQ
- CTA

## 8. `/security` — New

Text-heavy, scannable. Sections:
- Philosophy (one paragraph)
- What data we collect and why
- Where data is stored and how long
- FERPA / COPPA posture — **descriptive, not claimed** (we have no formal certifications — never write "FERPA certified")
- Academic integrity — how the integrity checker works
- Model safety — moderation, no answer-giving, jailbreak protections
- Subprocessors list (Anthropic, Vercel, Postgres host, etc.)
- Contact: security@veradicai.com

## 9. Shared Components

New or evolved in `web/src/components/landing/`:
- `nav.tsx` (evolved — subjects dropdown, mobile overlay)
- `hero.tsx` (evolved)
- `eyebrow.tsx` (new)
- `section.tsx` (new — `variant: default | alt | invert`)
- `feature-card.tsx` (new)
- `stat-block.tsx` (new)
- `process-steps.tsx` (new)
- `testimonial-marquee.tsx` (new — two rows, bidirectional, pause on hover, reduced-motion aware)
- `logo-strip.tsx` (new)
- `demo-walkthrough.tsx` (new — starts as placeholder)
- `cta-band.tsx` (new — full-bleed gradient)
- `subject-card.tsx` (new)
- `topic-pill-grid.tsx` (new)
- `faq.tsx` (evolved)
- `footer.tsx` (evolved — four-column)

## 10. SEO

**Metadata targets:**
- `/` — "Veradic AI — AI Tutor for Schools, Teachers, and Students"
- `/teachers` — keep existing metadata (content frozen)
- `/students` — "Homework Help That Guides You, Not Gives Answers | Veradic AI"
- `/subjects/math` — "AI Math Tutor for Schools — Algebra to Calculus | Veradic AI"
- `/subjects/physics` — "AI Physics Tutor for Schools — Mechanics to Modern Physics | Veradic AI"
- `/subjects/chemistry` — "AI Chemistry Tutor for Schools — Stoichiometry to Organic | Veradic AI"
- `/security` — "Security, Privacy & Academic Integrity | Veradic AI"

**Structural SEO:**
- JSON-LD: `SoftwareApplication` (home), `Organization` (site-wide), `FAQPage` (any page with FAQ), `EducationalOccupationalProgram` (subject pages)
- Sitemap updated: `/` 1.0, `/teachers` 0.9, subject pages 0.85, `/students` 0.8, `/security` 0.7
- Canonical URLs
- Unique OG/Twitter images per page (reuse existing dynamic pattern)
- Internal linking: every page links to ≥2 others contextually
- Keyword targets: "ai math tutor for schools", "ai homework help for classrooms", "integrity checker ai homework", "chatgpt alternative for schools", "ai tutor ferpa", "ai tutor common core", "chemistry tutor app for schools"

## 11. Placeholder Teacher Testimonials (ship these in the marquee)

Flag all as `TODO: replace with real testimonials`.

1. *"My students actually engage with the material now. Veradic won't just hand them answers, so they have to think — and they do."* — **Sarah Mitchell**, 9th Grade Algebra Teacher, Lincoln High School
2. *"The integrity checker has been a game-changer. I finally know which kids are doing their own work."* — **David Okafor**, AP Physics Teacher, Westbrook Academy
3. *"I used to spend my whole Sunday grading. Now I'm done in an hour."* — **Jennifer Liu**, Pre-Calculus Teacher, Rosewood Prep
4. *"Every student gets one-on-one tutoring, even in a class of 32. I don't know how I taught without this."* — **Marcus Reed**, 7th Grade Math, Franklin Middle School
5. *"I was skeptical of AI in the classroom. Veradic is the first one built like it was actually designed by a teacher."* — **Amanda Torres**, Chemistry Department Chair, St. Vincent High School
6. *"My struggling students aren't embarrassed to ask Veradic for help. They would be with me."* — **Greg Henderson**, Algebra II Teacher, Oakridge High
7. *"The question bank saved me hours of worksheet prep. I upload my unit, approve the questions I like, and I'm done."* — **Priya Nair**, Geometry Teacher, Mapleton High School
8. *"I can finally see where every student is struggling before the test, not after."* — **Thomas Bellamy**, 8th Grade Science, Harmon Middle School
9. *"Veradic handles the kids who are ahead AND the kids who are behind — at the same time. That's never been possible for me before."* — **Rachel Goldstein**, 6th Grade Math, Pine Valley Elementary
10. *"My principal was worried about AI cheating. I showed her the integrity checker and she approved us for the whole department."* — **Kevin Park**, AP Calculus Teacher, Everett Heights High
11. *"The step-by-step walkthroughs are exactly how I'd explain it myself. It's uncanny."* — **Nicole Sanders**, Physics Teacher, Bay Harbor High
12. *"I've tried every AI tool out there. Veradic is the only one that doesn't just give the answer away."* — **Brian Callahan**, Math Department Chair, Northfield Academy

## 12. Honest Copy Rules

- No FERPA/COPPA certification claims — use "aligned with" or "built with… in mind"
- No LMS integration claims (Canvas, Google Classroom, Schoology) — not built yet. Say "LMS integrations coming."
- No fabricated school counts or "trusted by N schools" stats — use real numbers or cut
- No curriculum standard alignment claims unless present in code
- Student/teacher testimonials are flagged placeholders until real ones arrive
- School logos are placeholders until real ones arrive

## 13. Mobile UX

- Hero type 96px → 44px
- Nav → full-screen overlay with pinned "Book a demo"
- Feature grids → single column
- Process steps → vertical timeline
- Stat blocks → 2-wide then 1-wide
- Hero visual below copy
- 44px touch targets
- Subject dropdown → accordion in mobile menu
- Testimonial marquee still scrolls (not swipe) on mobile

## 14. Accessibility & Edge Cases

- Meaningful alt text on all images
- AA contrast minimum, AAA for body text
- Keyboard navigable, visible focus rings
- Skip-to-content link
- Semantic headings (one H1 per page)
- Dark mode works on every section including contrast CTA band
- `prefers-reduced-motion` honored (Framer Motion + marquee)
- Logo failures → text fallback
- Demo video failure → poster + modal fallback
- Broken old links → redirects in `next.config.js` where needed

## 15. Asset Placeholder List (hand to user after commits)

**Screenshots (from app UI):**
1. Hero composite: student guided steps + teacher dashboard
2. School logo strip (greyscale)
3. Student step decomposition with chat bubble
4. Integrity checker flagging a submission
5. Teacher question bank approval view
6. Student school-mode view (locked bank)
7. Math problem demo shot
8. Physics problem demo shot
9. Chemistry demo shot with SMILES rendering
10. Student app screenshots for `/students`

**LLM output captures (genuine Veradic responses):**
11. Math — multi-step problem fully walked through (algebra/calculus/word problem)
12. Physics — real mechanics or EM problem walked through
13. Chemistry — stoichiometry or equilibrium problem, ideally rendering SMILES
14. Integrity example — AI asking follow-up questions and catching a student who didn't do the work

**Data / decisions:**
15. Real teacher testimonials to replace the 12 placeholders
16. Real school logos to replace placeholders
17. Actual pilot / classroom / user counts for stat blocks — or cut the stats
18. Demo email address: `demo@veradicai.com`? Something else?
19. Security page subprocessor list confirmation

## 16. Implementation Order

Each is a small PR-sized commit (~150 lines). Pause after each for user review.

1. `feat(marketing): add design tokens and shared section/eyebrow primitives`
2. `feat(marketing): rebuild navbar with subjects dropdown and mobile overlay`
3. `feat(marketing): rebuild footer as four-column layout`
4. `feat(marketing): new homepage hero + problem section`
5. `feat(marketing): homepage pillars, demo, subject strip sections`
6. `feat(marketing): homepage teachers, students, integrity, marquee testimonials, CTA band`
7. `feat(marketing): restyle /teachers page to new design system (no content changes, adds marquee)`
8. `feat(marketing): subject page template + math content`
9. `feat(marketing): physics and chemistry subject content`
10. `feat(marketing): students page`
11. `feat(marketing): security page`
12. `feat(marketing): SEO metadata, schema, sitemap, OG images`
13. `feat(marketing): restyle legal pages to match (content unchanged)`
14. `chore(marketing): placeholder list + README for asset drops`

## 17. Out of Scope (future plans)

- Full content overhaul for `/teachers`
- Blog / resources section
- Real demo scheduler (Calendly-style)
- Real lead capture form beyond the existing `/teachers` form
- LMS integrations
- Curriculum standard alignment tagging
- `/pricing` page (currently "contact us")
- `/about` page
