# Landing Page Redesign Plan

## Problem
Current landing page looks "vibecoded" — same purple gradients, card grids, fade-in animations, and layout as every AI-generated website. No product visuals, no social proof, redundant sections.

## Approach
Show the product, break grid monotony, earn trust, fewer but deeper sections.

## Sections (top to bottom)

### 1. Hero (rewrite)
- Two-column: text left (headline + CTA + social proof line), product mockup right (styled learn session UI in browser frame)
- Remove animated gradient orbs
- Keep "Snap. Learn. Master." headline

### 2. Features → "See It In Action" (rewrite)
- 3 alternating text+mockup rows (Step-by-Step, Chat, Practice)
- Small "Also included" strip for secondary features (Work Diagnosis, Mock Exams, History)

### 3. Social Proof (new)
- Stats strip or founder story line

### 4. CTA + Teacher Callout (merge)
- Clean CTA section (no gradient blob)
- Single-line teacher link below

### 5. Footer (expand)
- Add Product and Company columns

### Deleted sections
- How It Works (redundant with hero + features)
- Subjects (redundant with features)

## Files
- hero.tsx: complete rewrite
- features.tsx: complete rewrite  
- product-mockup.tsx: new (reusable mockup components)
- social-proof.tsx: new
- cta.tsx: rewrite (merged with teacher callout)
- teacher-callout.tsx: delete
- how-it-works.tsx: delete
- subjects.tsx: delete
- navbar.tsx: simplify
- footer.tsx: expand
- page.tsx: restructure
- globals.css: minor tweaks
