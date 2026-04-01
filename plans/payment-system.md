# Payment System

## Goal
Gate premium features behind a subscription using RevenueCat as the single source of truth for all platforms (mobile IAP + web Stripe). Free users get limited access; Pro users get unlimited access.

## Architecture

```
Mobile (RevenueCat Native SDK)
  ├── PaywallScreen — shows plans, handles purchase/restore
  ├── revenuecat.ts — SDK wrapper (init, purchase, restore)
  └── entitlements store — fetches entitlement state from backend

Web (RevenueCat Web SDK + Stripe)
  ├── pricing/page.tsx — shows plans, handles purchase via RC
  ├── services/revenuecat.ts — RC Web SDK wrapper (dual-key: weekly/annual)
  └── entitlements store — fetches entitlement state from backend

Backend (FastAPI)
  ├── entitlements.py — check_entitlement() enforces feature gates
  ├── webhook.py — /webhooks/revenuecat processes lifecycle events (all platforms)
  ├── User model — subscription_tier, status, expires_at, rc_customer_id
  └── config.py — bypass_subscription flag for dev mode
```

## Payment Flow (All Platforms)

```
User selects plan → RevenueCat SDK handles checkout
  ↓
RC processes payment (Apple/Google IAP or Stripe for web)
  ↓
RC fires webhook → POST /webhooks/revenuecat
  ↓
Backend updates user subscription fields
  ↓
Frontend refetches entitlements → shows Pro status
```

## Web Dual-Key Setup

Two separate RC Stripe apps exist for optimal pricing:
- **Weekly** app — `NEXT_PUBLIC_RC_WEEKLY_KEY` env var
- **Annual** app — `NEXT_PUBLIC_RC_ANNUAL_KEY` env var

The web RC service configures the SDK with the correct key based on the plan the user selects before initiating purchase.

## Subscription Tiers

| Tier | Sessions/day | Mock Tests | Work Diagnosis | Image Scan | History |
|------|-------------|------------|----------------|------------|---------|
| Free | 5           | No         | No             | 3/day      | Last 5  |
| Pro  | Unlimited   | Yes        | Yes            | Yes        | Full    |

## Feature Gating (Backend)

`check_entitlement(db, user, entitlement)` is called before gated actions:
- Returns immediately if `settings.bypass_subscription` is True (dev mode)
- Returns immediately if the user is Pro (`is_pro()` checks tier + status + expiry)
- Otherwise enforces limits or raises `EntitlementError`

Entitlements: `CREATE_SESSION`, `CHAT_MESSAGE`, `IMAGE_SCAN`, `WORK_DIAGNOSIS`

## RevenueCat Webhook

- `POST /webhooks/revenuecat` — single endpoint for all platforms
- Events: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE_DETECTED, SUBSCRIPTION_PAUSED, PRODUCT_CHANGE
- Matches users by `app_user_id` (our internal user ID)
- Provider mapped from store: APP_STORE→apple, PLAY_STORE→google, STRIPE→stripe
- Webhook secret verified via Authorization header (skipped in dev mode)
- Always returns 200 to prevent retries

## User Model Fields
- `subscription_tier` — "free" | "pro"
- `subscription_status` — "none" | "active" | "trial" | "cancelled" | "expired" | "billing_issue"
- `subscription_provider` — "apple" | "google" | "stripe" | "promo" | null
- `subscription_expires_at` — grace period support
- `rc_customer_id` — RevenueCat customer identifier
- `stripe_customer_id` — Stripe customer identifier (managed by RC, kept for reference)

## Dev Mode Bypass
- Backend: `BYPASS_SUBSCRIPTION=true` in `.env` → all entitlement checks pass
- Mobile: placeholder API keys → RevenueCat init skipped with warning log
- Web: missing RC env vars → purchase throws error with clear message
- No real purchases or webhook processing needed during development

## Implementation Status
1. ✅ DB migration — subscription fields on users table
2. ✅ Entitlement system — `check_entitlement()` + `EntitlementError`
3. ✅ Route integration — session, mock test, work, image routes check entitlements
4. ✅ RevenueCat webhook — processes all platform events (mobile + web)
5. ✅ Mobile SDK — revenuecat.ts service wrapper
6. ✅ Web SDK — revenuecat.ts with dual-key setup
7. ✅ Entitlement stores — Zustand stores sync state from backend
8. ✅ PaywallScreen (mobile) — modal with plan selection, purchase, restore
9. ✅ Pricing page (web) — plan cards, RC checkout, manage subscription
10. ⬜ App Store / Play Store — configure products in store dashboards
11. ⬜ RevenueCat dashboard — finalize project setup, configure webhook URL
12. ⬜ Production deploy — set real API keys, webhook secret, test end-to-end
