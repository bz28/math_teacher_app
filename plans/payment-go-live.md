# Payment System Go-Live Checklist

## 1. Apple Developer Account

- [ ] Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
- [ ] Accept all agreements in App Store Connect (Paid Apps agreement requires banking + tax info)
- [ ] Create App ID for the app in Certificates, Identifiers & Profiles

## 2. App Store Connect — In-App Subscriptions

- [ ] Create a new app in [App Store Connect](https://appstoreconnect.apple.com/)
- [ ] Go to **Monetization > Subscriptions** and create a subscription group (e.g. "Veradic Pro")
- [ ] Create two subscription products:
  - **Monthly**: $9.99/month, auto-renewable
  - **Yearly**: $59.99/year, auto-renewable, with 7-day free trial
- [ ] Set subscription descriptions, display names, and review screenshots
- [ ] Submit subscriptions for review (Apple reviews subscriptions separately from the app)

## 3. RevenueCat Setup

- [ ] Create a [RevenueCat](https://www.revenuecat.com/) project
- [ ] Connect App Store:
  - Add App Store Connect API key (Keys > Integrations > App Store Connect)
  - Add your app's bundle ID
  - Add the shared secret from App Store Connect (App > App Information > App-Specific Shared Secret)
- [ ] Create **Products** in RevenueCat matching your App Store product IDs
- [ ] Create an **Offering** named "default" with two packages:
  - `$rc_monthly` → your monthly product
  - `$rc_annual` → your yearly product
- [ ] Create **Entitlement** named "pro" and attach both products to it

## 4. RevenueCat API Keys

- [ ] Copy the **iOS API key** from RevenueCat (Project Settings > API Keys)
- [ ] Replace the test key in `mobile/src/services/revenuecat.ts`:
  ```ts
  const REVENUECAT_IOS_KEY = "appl_YOUR_REAL_KEY_HERE";
  ```
- [ ] (Optional) If launching on Android later, create a Google Play app and add the Android API key

## 5. RevenueCat Webhook

- [ ] In RevenueCat dashboard, go to **Project Settings > Integrations > Webhooks**
- [ ] Add webhook URL: `https://math-teacher-api.up.railway.app/v1/webhooks/revenuecat`
- [ ] Set an **Authorization header** value (this is your webhook secret)
- [ ] Copy that secret and set it in Railway:
  ```
  REVENUECAT_WEBHOOK_SECRET=your_secret_here
  ```
- [ ] Test the webhook by making a sandbox purchase (see step 7)

## 6. Backend Configuration (Railway)

- [ ] Set environment variable:
  ```
  REVENUECAT_WEBHOOK_SECRET=your_webhook_secret
  BYPASS_SUBSCRIPTION=false
  ```
- [ ] Run database migration: `alembic upgrade head` (already done if PR #102 is merged)
- [ ] Verify `/v1/webhooks/revenuecat` returns 200 when hit with a POST

## 7. Sandbox Testing (Before App Store Submission)

- [ ] Create a [Sandbox Tester](https://appstoreconnect.apple.com/access/testers) in App Store Connect
- [ ] Sign out of your real Apple ID on device: Settings > Media & Purchases > Sign Out
- [ ] Open the app, hit the paywall, and tap Subscribe
- [ ] Sign in with sandbox tester credentials when prompted
- [ ] Verify the purchase completes and the app shows Pro access
- [ ] Check RevenueCat dashboard — the sandbox purchase should appear
- [ ] Check your backend logs — the webhook should fire and update the user's subscription
- [ ] Verify `/auth/me` returns `is_pro: true` after the webhook fires
- [ ] Test **Restore Purchases** on the paywall
- [ ] Test subscription expiration (sandbox subscriptions renew every 3-5 minutes and expire after 5-6 renewals)

## 8. Production Launch

- [ ] Swap RevenueCat API key from test to production (if using separate keys)
- [ ] Set `BYPASS_SUBSCRIPTION=false` on Railway (if not already)
- [ ] Submit app for App Store review with subscription products
- [ ] After approval, verify a real purchase works end-to-end

## 9. Stripe (Web via RevenueCat)

Stripe is managed through RevenueCat. See `plans/stripe-setup.md` for details.

- [ ] Verify Stripe accounts are connected in RC dashboard
- [ ] Copy SDK API keys for weekly + annual RC Stripe apps
- [ ] Set Vercel env vars: `NEXT_PUBLIC_RC_WEEKLY_KEY`, `NEXT_PUBLIC_RC_ANNUAL_KEY`
- [ ] Test web purchase flow with Stripe test cards

## Code Changes Required

| File | What to Change | When |
|------|---------------|------|
| `mobile/src/services/revenuecat.ts` | Replace `REVENUECAT_IOS_KEY` with real key | After RevenueCat project created |
| `mobile/src/services/revenuecat.ts` | Replace `REVENUECAT_ANDROID_KEY` placeholder | When launching Android |
| Vercel env vars | Set `NEXT_PUBLIC_RC_WEEKLY_KEY` + `NEXT_PUBLIC_RC_ANNUAL_KEY` | After RC Stripe apps created |
| Railway env vars | Set `REVENUECAT_WEBHOOK_SECRET` | After webhook configured |
| Railway env vars | Set `BYPASS_SUBSCRIPTION=false` | When going live |

## What Works Without Any Setup

Even before completing this checklist:
- App runs normally, free tier enforced (3 sessions/day)
- Paywall shows with hardcoded prices
- Tapping Subscribe shows "not available" alert (graceful failure)
- Admin can manually upgrade users via dashboard
- `BYPASS_SUBSCRIPTION=true` on Railway removes all limits for dev/testing
