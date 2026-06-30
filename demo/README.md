# Veradic — standalone demo

A self-contained, **static** walkthrough of the Veradic product, used for sales/pitch.
No backend, no auth — every bit of content is bundled JSON. This is the shareable
demo (e.g. `demo.veradicai.com`), deliberately separate from the admin dashboard so
the pitch can be shared and iterated without touching internal tooling.

## Routes
- `/` — the pitch hub: value prop, the "a day in your teacher's life" flow spine, the
  honest ROI calculator, and the school/referral close.
- `/present` and `/present/{integrity,grading,generation,teacher-day}` — full-screen
  **present mode** for screen-sharing (no chrome, ← / → between stories).

## Local dev
```
npm install
npm run dev      # Vite, http://localhost:5173
```

## Build
```
npm run build    # → dist/ (static; tsc -b && vite build)
```

## Deploy (Vercel)
Create a **new** Vercel project from this repo (separate from the main app):
- **Root Directory:** `demo`
- **Framework:** Vite · **Build:** `npm run build` · **Output:** `dist` · **Install:** `npm install`
- **No env vars** — fully static. SPA deep-links (`/present/*`) are handled by `vercel.json`.

Then add your domain in **Settings → Domains** (e.g. `demo.veradicai.com`) and point a
**CNAME** (`demo` → `cname.vercel-dns.com`) at your DNS host. `index.html` sets
`robots: noindex,nofollow`, so the link is shareable but not search-indexed.
