# Marketing site — asset & decision checklist

This is the punch list of real assets, LLM captures, and copy decisions
needed to replace placeholders that shipped with the redesign. Every
placeholder in the code is marked with `TODO:` or `Screenshot placeholder`
so it's grep-able.

## 1. Screenshots from the app UI

Each of these is currently a `TODO:` comment in code or a dashed-border
"Screenshot placeholder" block. Ideal asset: a clean PNG/WebP on a
transparent background OR a composed screenshot on a white card.

| # | Where it goes | What it should show |
|---|---|---|
| 1 | Homepage hero — right side | Composite: student "guided steps" view next to a teacher's dashboard. A chat bubble should be visible on one of the steps. File: `web/src/components/landing/hero.tsx` |
| 2 | Homepage logo strip | 5–8 greyscale school/district logos (if any pilots are in place). Otherwise delete the logo strip. |
| 3 | Homepage pillar #1 ("Teaches, doesn't tell") | A real step decomposition screenshot with a follow-up question in a chat bubble on one of the steps. File: `web/src/components/landing/home-pillars.tsx` |
| 4 | Homepage pillar #2 ("Catches work that isn't theirs") | Integrity checker UI showing an AI follow-up question flagged, ideally with an integrity score. |
| 5 | Homepage pillar #3 ("Teacher-controlled content") | Question bank approval view — teacher reviewing AI-generated problems with approve / reject buttons. |
| 6 | `/teachers` page hero visual | (Not currently placed — optional. If added, should be a teacher dashboard overview.) |
| 7 | `/subjects/math` demo area | Real in-app screenshot of Veradic walking through one math problem. |
| 8 | `/subjects/physics` demo area | Same, for physics. |
| 9 | `/subjects/chemistry` demo area | Same, for chemistry. Ideally includes a SMILES molecular structure rendered inline to highlight that feature. |
| 10 | `/students` page hero | Phone mockup of the student mobile app. Can replace the current text-only hero. |

## 2. LLM output captures (real Veradic responses)

The homepage demo and each subject page demo currently use **hand-written
placeholder steps** that approximate what Veradic would say. For the
real launch we should capture actual LLM output and paste it in.

Each capture should include:
- The original problem text
- Each step's short label and the exact question/hint Veradic produced
- ~4–6 steps per problem

| # | Where it goes | Requested problem type |
|---|---|---|
| 11 | `web/src/components/landing/home-demo.tsx` (homepage demo) | Any subject. Pick the most impressive decomposition across the three subjects after capturing 12–14. |
| 12 | `web/src/app/subjects/math/page.tsx` (`demo` constant) | A multi-step word problem OR a calculus optimization problem. Current placeholder uses a rectangle perimeter — swap in something harder. |
| 13 | `web/src/app/subjects/physics/page.tsx` (`demo` constant) | An energy-conservation problem or a multi-step kinematics problem. Current placeholder uses a frictionless incline — capture the real walkthrough. |
| 14 | `web/src/app/subjects/chemistry/page.tsx` (`demo` constant) | A stoichiometry problem, ideally one that would benefit from rendering a SMILES structure inline. Current placeholder uses methane combustion. |
| 15 | `web/src/components/landing/home-pillars.tsx` (pillar #2 / integrity card) | A real integrity-check dialogue showing Veradic asking 2–3 follow-up questions that catch a student who didn't do their own work. |

## 3. Placeholder content that needs real data or user approval

| # | Where | Current state | What's needed |
|---|---|---|---|
| 16 | `web/src/components/landing/testimonial-marquee.tsx` | 12 placeholder teacher testimonials with plausible names, roles, schools | Replace with real quotes from real teachers. Each needs name, role, and school. |
| 17 | `web/src/components/landing/home-teachers.tsx` | 4 placeholder stats (hours saved, 1-on-1 coverage, homework assembly time, unsupervised chat count) | Real pilot data — or cut the stat grid until we have it. |
| 18 | Homepage logo strip | Placeholder shapes | Real school/district logos (greyscale) — or cut the section. |
| 19 | `/teachers` page demo form | Existing, works today | No changes needed — this form is live and hitting the real `contact.submitLead()` API. |
| 20 | Hero composite product mockup (`hero.tsx`) | Currently reuses existing `LearnSessionMockup` | Swap for a real composed screenshot per item #1. |

## 4. Copy / business decisions

| # | Decision | Context |
|---|---|---|
| 21 | **App store badges on `/students`** | Currently a text note "App store badges coming soon". Replace with real iOS and Google Play badges once the mobile app is live on the stores. |
| 22 | **Email addresses** | Code currently uses `hello@veradicai.com` (subject "more subjects" + CTA secondary), `security@veradicai.com` (security page), and `/teachers#contact` (primary CTAs everywhere). Confirm these are the right addresses or swap. |
| 23 | **FERPA / COPPA language** | `/security` page explicitly states no formal certifications are held. If a formal attestation is obtained, update the section. |
| 24 | **Subprocessor list** | `/security` lists Anthropic, Vercel, managed Postgres, Cloudflare, RevenueCat as a best-guess. Verify this matches the actual production stack. |
| 25 | **Testimonial disclosure** | Current placeholders are plausibly fake. Before launch, either (a) replace with real quotes, or (b) add a small "Illustrative quotes from early access teachers" disclaimer, or (c) remove the marquee. Do not ship invented quotes without disclosure. |

## 5. Things intentionally left out of this pass

These are documented in `plans/marketing-site-redesign.md` as future work:

- Full content overhaul for `/teachers` (kept content-frozen in this pass)
- Blog / resources section
- Real demo scheduler (Calendly embed)
- Pricing page (currently "contact us" messaging)
- About page
- LMS integrations positioning
- Curriculum standard alignment tagging
- `/schools` rename (kept as `/teachers`)

## 6. How to swap a placeholder

Every placeholder is tagged in one of these ways:
- `// TODO: replace with real …` comments in `.tsx` files
- `Screenshot placeholder` visible text in the rendered page (inside a dashed border)
- `TODO: replace with real testimonials …` on the testimonials array

`grep -r "TODO:" web/src/components/landing/ web/src/app/` will show
every remaining placeholder location.
