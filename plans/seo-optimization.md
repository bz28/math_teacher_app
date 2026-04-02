# SEO Optimization Plan for Veradic AI

## Already Complete
- Sitemap (`web/src/app/sitemap.ts`)
- Robots.txt (`web/src/app/robots.ts`)
- JSON-LD (SoftwareApplication, Organization, WebSite) in root layout
- Core metadata, OG, Twitter cards
- Canonical URLs

---

## Phase 1: Diagnostics & Measurement (Quick Wins)

### 1A. Google Search Console Verification
Add a GSC verification meta tag to the root layout. Required to measure search performance — impressions, clicks, ranking positions.

### 1B. Google Analytics 4
Add GA4 via `next/script` with `afterInteractive` strategy. Tracks on-site behavior: bounce rate, time on page, conversion funnels.

### 1C. Web Vitals Monitoring
Enable Vercel Analytics or Next.js `reportWebVitals` to track Core Web Vitals (LCP, FID, CLS). Direct Google ranking factor.

---

## Phase 2: Rich Results & On-Page Content

### 2A. FAQ Section + FAQPage Schema on Landing Page
Add 6-8 question accordion FAQ to landing page with `FAQPage` JSON-LD schema. Creates expandable rich snippets in Google results (3-4x more vertical space, higher CTR). Targets long-tail question queries.

Example questions:
- "How does AI tutoring work?"
- "Can AI help me with my math homework?"
- "Is Veradic AI free?"
- "What subjects does Veradic AI cover?"
- "How is this different from just getting the answer?"
- "Do I need to create an account?"
- "Can my teacher see my progress?"

### 2B. Subject-Specific Landing Pages
Dedicated pages for each subject:
- `/subjects/math` — "AI Math Tutor"
- `/subjects/physics` — "AI Physics Tutor"
- `/subjects/chemistry` — "AI Chemistry Tutor"

Each page includes: subject-specific hero copy, meta title/description, example problems, feature highlights, OG image, CTA, `EducationalOccupationalProgram` schema.

---

## Phase 3: Technical Polish

### 3A. `next/image` Optimization
Replace `<img>` tags with `next/image` for lazy loading, WebP, responsive sizing.

### 3B. PWA Manifest
Add `manifest.webmanifest` with app name, icons, theme color, `display: standalone`.

### 3C. Internal Linking Structure
Cross-link landing page, subject pages, teachers page. Add footer with sitemap-style nav.

---

## Phase 4: Page-Level SEO Refinement

### 4A. Teachers Page Keyword Optimization
Add keyword-rich headings for "AI for schools", "AI tutoring platform for teachers", "classroom AI tools". Structure for testimonials/case studies.

### 4B. BreadcrumbList Schema
Add `BreadcrumbList` JSON-LD to subject pages and teachers page.

---

## Implementation Order
1. Sprint 1: GSC verification + GA4 + Web Vitals
2. Sprint 2: FAQ section with schema on landing page
3. Sprint 3: Subject landing pages
4. Sprint 4: `next/image` audit, internal linking, PWA manifest, teachers page, breadcrumbs
