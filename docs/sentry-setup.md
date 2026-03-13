# Sentry Setup Guide

Sentry provides error monitoring and performance tracking for both the backend (FastAPI) and mobile app (React Native). Free tier gives 5K errors/month and 10K transactions/month.

---

## Step 1: Create a Sentry Account

1. Go to https://sentry.io and click **Get Started Free**
2. Sign up with GitHub (easiest — links to your repos automatically)
3. Choose the **Developer (Free)** plan when prompted

---

## Step 2: Create the Backend Project (Python)

1. In Sentry, go to **Settings > Projects > Create Project**
2. Select **Python** as the platform (or search "FastAPI")
3. Name it `math-teacher-api`
4. Click **Create Project**
5. On the next page, Sentry will show you a DSN that looks like:
   ```
   https://abc123def456@o789.ingest.us.sentry.io/1234567
   ```
6. Copy this DSN — you'll need it for the next step

### Add the DSN to Railway

1. Go to your Railway dashboard → `math-teacher-api` service
2. Go to **Variables**
3. Add a new variable:
   ```
   SENTRY_DSN=https://abc123def456@o789.ingest.us.sentry.io/1234567
   ```
4. Railway will auto-redeploy with the new variable

The backend code already handles Sentry initialization — see `api/main.py:20-27`. Once the env var is set, it will:
- Initialize Sentry on startup
- Tag errors with `environment` (development/production)
- Sample 20% of transactions in production (100% in dev)

---

## Step 3: Create the Mobile Project (React Native)

1. In Sentry, go to **Settings > Projects > Create Project**
2. Select **React Native** as the platform
3. Name it `math-teacher-mobile`
4. Click **Create Project**
5. Copy the DSN from the setup page

### Add the DSN to your local environment

Add this line to `mobile/.env.local`:
```
EXPO_PUBLIC_SENTRY_DSN=https://xyz789@o789.ingest.us.sentry.io/7654321
```

The mobile code already handles initialization — see `mobile/App.tsx:23-26`. It will:
- Initialize Sentry with the DSN from the env var
- Only enable in production (`enabled: !__DEV__`)
- Catch all unhandled JS errors and render crashes (via ErrorBoundary)

---

## Step 4: Verify It Works

### Backend
After Railway redeploys, check the Sentry dashboard for a test event. You can trigger one by temporarily adding this to any route:

```python
import sentry_sdk
sentry_sdk.capture_message("Sentry backend test")
```

Or just wait for a real error to show up.

### Mobile
To test Sentry in a production-like build:

1. Create a preview build with EAS:
   ```bash
   cd mobile
   eas build --profile preview --platform ios
   ```
2. Any crash in the app will appear in the Sentry dashboard

Note: Sentry is disabled in dev mode (`__DEV__`), so you won't see events during `expo start`.

---

## Step 5: Set Up Alerts (Optional but Recommended)

1. In Sentry, go to **Alerts > Create Alert**
2. Create a **New Issue** alert:
   - Conditions: "A new issue is created"
   - Action: Send email notification
3. Create a **Spike** alert:
   - Conditions: "Number of events in 1 hour exceeds 50"
   - Action: Send email notification

This way you'll know immediately when something breaks in production.

---

## Summary of Environment Variables

| Variable | Where | Example |
|----------|-------|---------|
| `SENTRY_DSN` | Railway (backend) | `https://abc@o123.ingest.us.sentry.io/456` |
| `EXPO_PUBLIC_SENTRY_DSN` | `mobile/.env.local` | `https://xyz@o123.ingest.us.sentry.io/789` |

Both are optional — if the DSN is empty/missing, Sentry silently does nothing.
