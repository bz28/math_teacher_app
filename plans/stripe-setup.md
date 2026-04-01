# Stripe Setup (via RevenueCat)

Stripe is now managed through RevenueCat. Direct Stripe API integration has been removed.

## Setup

1. Connect your Stripe account(s) in [RevenueCat Dashboard > Project Settings > Stripe](https://app.revenuecat.com/)
2. Create Stripe apps in RC for each billing plan (weekly + annual)
3. Copy the SDK API keys and set them as env vars:
   - `NEXT_PUBLIC_RC_WEEKLY_KEY` — RC Stripe app key for weekly billing
   - `NEXT_PUBLIC_RC_ANNUAL_KEY` — RC Stripe app key for annual billing
4. Configure the RC webhook URL: `https://math-teacher-api.up.railway.app/v1/webhooks/revenuecat`
5. Set `REVENUECAT_WEBHOOK_SECRET` on Railway

## Testing (Sandbox)

1. Use sandbox API keys from RC dashboard for development
2. Stripe test cards work in sandbox mode: `4242 4242 4242 4242`
3. Set `BYPASS_SUBSCRIPTION=true` in `.env` to skip payment entirely during dev

## What Changed

Previously, the backend had direct Stripe integration (checkout sessions, customer portal, webhook handler). This has been replaced with RevenueCat's Stripe App, which:
- Handles Stripe checkout through the RC Web SDK
- Sends subscription events through the same RC webhook as mobile
- Provides a unified subscription management experience across all platforms
