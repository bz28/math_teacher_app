# Veradic AI Website

## Overview
Full website for Veradic AI — a public-facing landing page for marketing + a complete web app with feature parity to the mobile app. Built with Next.js (App Router), deployed on Vercel, hitting the existing FastAPI backend on Railway.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS v4 + CSS variables
- **State**: Zustand (same pattern as mobile)
- **Animations**: Framer Motion
- **Math rendering**: KaTeX
- **Math input**: MathLive
- **Deployment**: Vercel
- **Domain**: veradicai.com

## Build Order
1. Project scaffolding + design system
2. UI primitives
3. Landing page
4. Auth system
5. Home + subject selection
6. Problem input
7. Learn session (step-by-step)
8. Step chat
9. Learn queue (multi-problem)
10. Image scanning + upload
11. Practice mode
12. Mock test config + exam
13. Mock test results
14. Session history
15. Handwritten work diagnosis
16. Responsive design pass
17. SEO + performance

## Environment Variables
```
NEXT_PUBLIC_API_URL=https://math-teacher-api.up.railway.app/v1
NEXT_PUBLIC_SITE_URL=https://veradicai.com
```

## CORS
Backend needs Vercel domain added to CORS allowed origins.
