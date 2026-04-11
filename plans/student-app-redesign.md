# Student App Redesign — Web + Mobile

Branch: `feat/student-app-function-updates`

## Diagnosis
1. Too many taps to solve one problem (5 screens before first step)
2. Two divergent navigation models (web tabs vs mobile state machine)
3. Monolithic screens (`SessionScreen.tsx` 551 lines, `learn/page.tsx` 483 lines)
4. Image capture is two parallel complex systems
5. Half-built features clutter the surface
6. Accessibility near-zero

## Pillars

### Pillar 1 — Collapse the funnel: Snap → Solve in one screen
Replace Home → ModeSelect → Input → Queue → Session with a single **Solve** screen.
- Top: subject pill
- Middle: large camera/upload target + text input below
- Bottom: "Recent" strip (last 3 problems)
- Queue becomes inline chip row, not a screen
- 2 screens for core loop (was 5)

### Pillar 2 — One navigation model across platforms
4-tab bottom bar both platforms: **Solve · History · Library · Account**
- Mobile migrates to Expo Router / React Navigation
- Mode-select deleted; mode chosen inside Session via segmented control

### Pillar 3 — Session screen as focused reading experience
- Tiny header (thumbnail + step dots)
- Vertical card-per-step reader, KaTeX math
- Sticky 2-button action row: "I get it" / "Ask about this step"
- Inline follow-up Q&A (no modal)
- Completion: Practice similar / Save / New problem
- Split 551-line file into composed sub-views (~150 lines each)

### Pillar 4 — Unify image capture
Single 3-state extraction: `capture → confirm → extracted`
- Manual rectangle selector becomes opt-in fallback
- Shared component contract across web + mobile

### Pillar 5 — Accessibility & polish baseline
- ARIA / accessibilityLabel on every icon button
- Focus management on modals
- 44pt tap targets
- Skeleton loaders, no layout jumps
- Web Solve screen works at 320px; mobile handles landscape

## Out of scope
- New features (voice, hints, AI tutor chat)
- School/teacher dashboard
- Marketing pages
- Backend API changes

## Rollout order
1. Pillar 2 (navigation foundation)
2. Pillar 1 (Solve screen)
3. Pillar 4 (image capture)
4. Pillar 3 (Session reader)
5. Pillar 5 (a11y + polish, continuous)
