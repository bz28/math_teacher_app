# Payment System

## Goal
Gate premium features behind a subscription using RevenueCat for in-app purchases and a server-side entitlement system for enforcement. Free users get limited access; Pro users get unlimited access.

## Architecture

```
Mobile (RevenueCat SDK)
  ├── PaywallScreen — shows plans, handles purchase/restore
  ├── revenuecat.ts — SDK wrapper (init, purchase, restore)
  └── entitlements store — fetches entitlement state from backend

Backend (FastAPI)
  ├── entitlements.py — check_entitlement() enforces feature gates
  ├── webhook.py — /webhooks/revenuecat processes lifecycle events
  ├── User model — subscription_tier, status, expires_at, rc_customer_id
  └── config.py — bypass_subscription flag for dev mode
```

## Subscription Tiers

| Tier | Sessions/day | Mock Tests | Work Diagnosis | Image Scan | History |
|------|-------------|------------|----------------|------------|---------|
| Free | 3           | No         | No             | No         | Last 5  |
| Pro  | Unlimited   | Yes        | Yes            | Yes        | Full    |

## Feature Gating (Backend)

`check_entitlement(db, user, entitlement)` is called before gated actions:
- Returns immediately if `settings.bypass_subscription` is True (dev mode)
- Returns immediately if the user is Pro (`is_pro()` checks tier + status + expiry)
- Otherwise enforces limits or raises `EntitlementError`

Entitlements: `CREATE_SESSION`, `MOCK_TEST`, `WORK_DIAGNOSIS`, `IMAGE_SCAN`, `FULL_HISTORY`

## RevenueCat Integration

### Mobile
- `initRevenueCat(userId)` — configures SDK with platform-specific API key
  - Skips init when API key is a placeholder (dev mode guard)
- `getOfferings()` — fetches available packages (monthly/annual)
- `purchasePackage(pkg)` — handles purchase, returns `null` on user cancel
- `restorePurchases()` — restores after reinstall/device switch

### Backend Webhook
- `POST /webhooks/revenuecat` — processes lifecycle events
- Events: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE_DETECTED, SUBSCRIPTION_PAUSED, PRODUCT_CHANGE
- Matches users by `rc_customer_id` (set during mobile auth)
- Webhook secret verified via Authorization header (skipped in dev mode)
- Always returns 200 to prevent retries

## User Model Fields
- `subscription_tier` — "free" | "pro"
- `subscription_status` — "none" | "active" | "trial" | "cancelled" | "expired" | "billing_issue"
- `subscription_provider` — "revenuecat" | null
- `subscription_expires_at` — grace period support
- `rc_customer_id` — RevenueCat customer identifier

## Dev Mode Bypass
- Backend: `BYPASS_SUBSCRIPTION=true` in `.env` → all entitlement checks pass
- Mobile: placeholder API keys (`appl_XXXXXXXX`) → RevenueCat init skipped with warning log
- No real purchases or webhook processing needed during development

## Implementation Sequence
1. ✅ DB migration — add subscription fields to users table
2. ✅ Entitlement system — `check_entitlement()` + `EntitlementError`
3. ✅ Route integration — session, mock test, work, image routes check entitlements
4. ✅ RevenueCat webhook — process subscription lifecycle events
5. ✅ Mobile SDK — revenuecat.ts service wrapper
6. ✅ Entitlement store — Zustand store syncs state from backend
7. ✅ PaywallScreen — modal with plan selection, purchase, restore
8. ⬜ App Store / Play Store — configure products in store dashboards
9. ⬜ RevenueCat dashboard — create project, add API keys, configure webhook URL
10. ⬜ Production deploy — set real API keys, webhook secret, test end-to-end
