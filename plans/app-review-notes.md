# App Review Notes — Veradic v1.0

Everything that goes into the **App Review Information** section of App Store Connect. Copy-paste this verbatim unless noted.

---

## Sign-In Required

✅ Yes — app functionality requires an account.

## Demo Account (required because sign-in is required)

Create this account in production before submitting. Pre-seed it with an active annual subscription (flip the entitlement flag manually in the DB) so reviewers see the Pro flows without needing to complete an IAP.

| Field | Value |
|---|---|
| Email | `appreview@veradicai.com` |
| Password | *(set a strong password — put it here once created)* |

**Before submission:** confirm this account exists, is a seeded Pro user, and has 2-3 completed sessions in its history so the History tab doesn't look empty.

## Review Notes (paste into ASC "Notes" field)

```
ABOUT VERADIC
Veradic is an AI-powered math and chemistry tutor. Students scan or type a problem, and the app generates a step-by-step guided learning session. The app uses Anthropic's Claude API on the backend to generate tutoring content; no user-to-user messaging, social features, or user-generated content shared between users.

HOW TO REVIEW THE CORE FLOW
1. Sign in with the demo account above.
2. Tap the Solve tab (default). Tap the camera icon and grant camera permission when prompted.
3. Point the camera at any printed math problem, or tap "Type instead" and enter a problem like "solve 2x + 5 = 13".
4. Select "Learn Mode" when prompted.
5. The app breaks the problem into ordered steps. Tap through each step; optionally tap the chat icon to ask the AI a question.

ACCOUNT DELETION
Available in-app at Account tab (bottom right) → scroll down → "Delete Account" → confirm with password.

AGE GATE
Veradic enforces a 13+ minimum age at sign-up. The signup flow (3 steps: Name → Age → Email/Password) uses an age slider whose minimum value is 13, so users cannot sign up with an age under 13. See screen 2 of the registration flow.

SIGN IN WITH APPLE
Not applicable — Veradic uses first-party email/password authentication only. No third-party social logins (Google, Facebook, etc.) are offered, so Sign in with Apple is not required per Guideline 4.8.

AI DISCLOSURE
AI usage is disclosed in-app at Account tab → "About Veradic AI" and in the app listing description. Backend applies a safety prompt to keep Claude responses constrained to math/science tutoring.

SUBSCRIPTIONS
Two auto-renewable subscriptions are offered (Weekly $2.99, Annual $79.99 with 3-day free trial). Auto-renewal disclosure appears on the paywall above the CTA. "Restore Purchases" is available on the paywall. Managed via RevenueCat.

SUPPORT
support@veradicai.com
```

## Contact Info

| Field | Value |
|---|---|
| First name | *(founder first name)* |
| Last name | *(founder last name)* |
| Phone | *(contact phone)* |
| Email | `support@veradicai.com` |

## Attachment

If you create a 30-second screen recording of the scan → Learn flow, attach it here as `.mov` or `.mp4`. Not required but speeds up review.

## Version Release

Recommended: **Manually release this version**. Gives you control over launch timing (coordinate with any marketing push). Switch to "Automatically release" from v1.1 onward once the launch is stable.

## Export Compliance

| Question | Answer |
|---|---|
| Is your app designed to use cryptography or does it contain or incorporate cryptography? | Yes |
| Does your app qualify for any of the exemptions in Category 5, Part 2? | Yes (uses only HTTPS/standard OS crypto — Exemption 5D002.1) |

Already declared in `mobile/app.json` via `ios.config.usesNonExemptEncryption: false` so you won't be prompted each build.
