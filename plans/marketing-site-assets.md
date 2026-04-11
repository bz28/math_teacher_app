# Marketing site — asset & decision checklist

This is the punch list of real assets, LLM captures, and copy decisions
needed to replace placeholders that shipped with the redesign. Every
placeholder in the code is marked with `TODO:` or `Screenshot placeholder`
so it's grep-able.

## 1. Screenshots from the app UI

Ideal asset: a clean PNG/WebP on a transparent background OR a composed
screenshot on a white card.

| # | Where it goes | What it should show | Status |
|---|---|---|---|
| 1 | Homepage hero — right side | Replaced by live step-animation component (`hero-steps-animation.tsx`) using the real AI output for the quadratic `x² − 11x + 24 = 0`. | ✅ Done (math). Physics + chemistry solve flows pending for rotating animation. |
| 2 | Homepage logo strip | 5–8 greyscale school/district logos. Otherwise delete the logo strip. | ⏳ |
| 3 | Homepage pillar #1 ("Teaches, doesn't tell") | A real step decomposition screenshot with a follow-up question in a chat bubble on one of the steps. File: `web/src/components/landing/home-pillars.tsx` | ⏳ (have `if you ask a question in solve math.png` — needs wiring in) |
| 4 | `/subjects/math` demo area | Real in-app screenshot of Veradic walking through one math problem. | ⏳ |
| 5 | `/subjects/physics` demo area | Same, for physics. | ⏳ |
| 6 | `/subjects/chemistry` demo area | Same, for chemistry. Ideally includes a SMILES molecular structure rendered inline to highlight that feature. | ⏳ |
| 7 | `/students` page hero | Phone mockup of the student mobile app. Can replace the current text-only hero. | ⏳ |

### Removed from the needs list (feature not built out enough yet)

These have been stripped from the site layouts — no screenshot slot left.
When the respective features are mature, we can reopen:

- ~~Homepage pillar #2 screenshot (Integrity checker UI)~~ — pillar card now text-only
- ~~Homepage pillar #3 screenshot (Question bank approval view)~~ — pillar card now text-only
- ~~Teacher dashboard overview for `/teachers` hero or homepage~~ — no screenshot slot

The concepts themselves (integrity, teacher-controlled content, dashboard
functionality) still live in the site's prose copy. Only the image slots
are removed.

## 2. LLM output captures (real Veradic responses)

The hero animation on `/` and the demo sections on each `/subjects/*` page
use step-by-step AI output. Math is live with the real captured output.
Physics and chemistry still use hand-written placeholder steps.

| # | Where it goes | Requested problem type | Status |
|---|---|---|---|
| 8 | Homepage hero animation (`hero-steps-animation.tsx`) | Math quadratic factoring | ✅ Live with real output |
| 9 | `web/src/app/subjects/math/page.tsx` (`demo` constant) | A multi-step word problem OR calculus optimization. Current placeholder uses a rectangle perimeter. | ⏳ |
| 10 | `web/src/app/subjects/physics/page.tsx` (`demo` constant) | Energy conservation or multi-step kinematics. Current placeholder uses a frictionless incline. | ⏳ |
| 11 | `web/src/app/subjects/chemistry/page.tsx` (`demo` constant) | Stoichiometry, ideally with a SMILES structure. Current placeholder uses methane combustion. | ⏳ |

## 3. Placeholder content that needs real data or user approval

| # | Where | Current state | What's needed |
|---|---|---|---|
| 12 | `web/src/components/landing/topics-marquee.tsx` | Replaces the old testimonial marquee. Scrolls real topic names. | No real testimonial data required. |
| 13 | `web/src/components/landing/home-teachers.tsx` | 4 placeholder stats (hours saved, 1-on-1 coverage, homework assembly time, unsupervised chat count) | Real pilot data — or cut the stat grid until we have it. |
| 14 | Homepage logo strip | Placeholder shapes | Real school/district logos (greyscale) — or cut the section. |
| 15 | `/teachers` page demo form | Existing, works today | No changes needed — this form is live and hitting the real `contact.submitLead()` API. |

## 4. Copy / business decisions

| # | Decision | Context |
|---|---|---|
| 16 | **App store badges on `/students`** | Currently a text note "App store badges coming soon". Replace with real iOS and Google Play badges once the mobile app is live on the stores. |
| 17 | **Email addresses** | Code currently uses `hello@veradicai.com` (subject "more subjects" + CTA secondary), `security@veradicai.com` (security page), and `/teachers#contact` (primary CTAs everywhere). Confirm these are the right addresses or swap. |
| 18 | **FERPA / COPPA language** | `/security` page explicitly states no formal certifications are held. If a formal attestation is obtained, update the section. |
| 19 | **Subprocessor list** | `/security` lists Anthropic, Vercel, managed Postgres, Cloudflare, RevenueCat as a best-guess. Verify this matches the actual production stack. |

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
- Any screenshot of the teacher dashboard, question bank approval, or
  integrity checker UI (features not mature enough for marketing)

## 6. How to swap a placeholder

Every placeholder is tagged in one of these ways:
- `// TODO: replace with real …` comments in `.tsx` files
- `Screenshot placeholder` visible text in the rendered page (inside a dashed border)

`grep -r "TODO:" web/src/components/landing/ web/src/app/` will show
every remaining placeholder location.
