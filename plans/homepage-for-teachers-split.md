# Plan: Homepage → /for-teachers split

## Summary

Move the "why schools need this" narrative (HomeProblem) off the homepage onto a dedicated `/for-teachers` page. Homepage becomes a fast product overview. Teachers who need the backstory click "For Teachers" in the nav.

## Homepage (/) — 4 sections

1. **Hero** — animated StepsAnimation + "The AI tutor that teaches, instead of telling" + updated tagline: "Built for teachers, loved by students."
2. **HomeTeachers** — "Reclaim your evenings" + 4 feature cards (unchanged)
3. **HomeSubjects** — 3 subject cards (unchanged)
4. **CtaBand** — "Bring Veradic to your school" (unchanged)

HomeProblem removed from homepage.

## /for-teachers — 4 sections

1. **Compact hero** — Eyebrow "For Teachers", headline "Why schools need a new kind of AI", 1-2 sentence sub. No animated demo (homepage has that).
2. **HomeProblem** — AI-in-classrooms narrative + pain points (moved from homepage, same component)
3. **HomeTeachers** — "Reclaim your evenings" + 4 feature cards (shared component, same as homepage)
4. **CtaBand** — convert → /demo

Narrative arc: problem → empathy → solution → convert.

## Navbar

```
[Logo] | For Teachers | For Students | Sign In | [Book a demo]
```

"For Teachers" first (primary audience).

## Footer

Company column:
```
For Teachers → /for-teachers
Safety → /safety
Book a demo → /demo
```

## Sitemap

Add `/for-teachers` entry, priority 0.9, weekly.

## Hero tagline update

Current: "Built for schools, loved by teachers and students."
New: "Built for teachers, loved by students."

## Files to touch

| File | Change |
|---|---|
| `web/src/app/for-teachers/page.tsx` | NEW — compact hero + HomeProblem + HomeTeachers + CtaBand |
| `web/src/app/for-teachers/layout.tsx` | NEW — metadata + JSON-LD breadcrumb |
| `web/src/app/page.tsx` | Remove HomeProblem import + usage |
| `web/src/components/landing/hero.tsx` | Tagline: "Built for teachers, loved by students." |
| `web/src/components/landing/navbar.tsx` | Add "For Teachers" to primaryLinks before "For Students" |
| `web/src/components/landing/footer.tsx` | Add "For Teachers" to companyLinks |
| `web/src/app/sitemap.ts` | Add /for-teachers entry |

7 files. 2 new, 5 modified. ~115 lines added, ~5 removed.
