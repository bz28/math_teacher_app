# Pre-Submission Checklist — Veradic iOS v1.0

The things you personally must do before tapping "Submit for Review." Grouped by whether they block submission or just improve the odds.

---

## 🚨 BLOCKING — must be done or Apple will reject / build will fail

### Accounts & IDs

- [ ] Create Apple Developer account (paid, $99/yr) if not already active.
- [ ] Get your **Apple Team ID** (10-char alphanumeric from developer.apple.com → Membership).
- [ ] Get your **App Store Connect Apple ID** (the email address you use).
- [ ] Create the app in App Store Connect with bundle ID `com.veradicai.app`.
- [ ] Note the **ASC App ID** (numeric, shown in App Information after creating the app).

### Replace placeholders

Once you have the above values, edit `mobile/eas.json` and replace:
```
TODO_APPLE_ID@example.com  →  your Apple ID email
TODO_ASC_APP_ID            →  numeric App ID from ASC
TODO_APPLE_TEAM_ID         →  10-char Team ID
```

### IAP products in App Store Connect

- [ ] Create subscription group "Veradic Pro" in ASC.
- [ ] Create subscription `veradic_pro_annual` ($79.99/year, 3-day free trial).
- [ ] Create subscription `veradic_pro_weekly` ($2.99/week).
- [ ] Fill "Subscription Display Name" and "Subscription Description" for both.
- [ ] Upload a 1024×1024 "Promotional Image" for each (optional but speeds review).
- [ ] Match product IDs exactly in RevenueCat dashboard.
- [ ] Submit both for review with the first build (Apple reviews IAPs alongside the app).

### Assets

- [ ] Verify `mobile/assets/icon.png` is exactly 1024×1024, PNG, no alpha channel, no rounded corners (Apple adds them), no text overlay.
- [ ] Verify `mobile/assets/splash-icon.png` exists and displays well on white background.
- [ ] Produce 6 iPhone 6.7" screenshots (1290×2796) per `plans/app-store-listing.md`.
- [ ] (Optional) Produce 15-30s app preview video.

### Legal pages live

- [ ] `https://veradicai.com/privacy` returns 200 on mobile Safari.
- [ ] `https://veradicai.com/terms` returns 200 on mobile Safari.
- [ ] `https://veradicai.com/support` returns 200 on mobile Safari.
- [ ] (If you confirmed the web app is deployed on `veradicai.com` — verified by checking `web/src/app/(legal)/*` in repo.)

### Demo account for App Review

- [ ] Create `appreview@veradicai.com` in production.
- [ ] Manually flip its Pro entitlement on in the DB.
- [ ] Seed 2-3 completed sessions.
- [ ] Record the password in `plans/app-review-notes.md` (do NOT commit the password — keep it in 1Password / secrets manager and paste into ASC only).

### Backend safety prompt (recommended, may cause review pushback if missing)

- [ ] Add a system prompt pre-pended to all Claude API calls in `api/` that constrains responses to math / science / homework help. This is not strictly required but Apple's AI-content guideline (4.1) has rejected apps for lacking any moderation. ~10 lines of work in the API repo — track as a separate PR.

---

## 🟡 QUALITY — strongly recommended, affects approval speed and install rate

- [ ] Test account deletion end-to-end on TestFlight — verify the account is actually gone server-side, not just deactivated.
- [ ] Test "Restore Purchases" on a fresh install while signed into the demo account — confirm Pro entitlement restores.
- [ ] Walk through the full onboarding on a clean TestFlight install: name → age (try 12 to confirm the block) → age (try 13 to confirm pass) → grade → credentials → email confirmation.
- [ ] Camera permission prompt — verify the custom text ("Allow Veradic to use your camera…") appears.
- [ ] Photo picker permission prompt — same.
- [ ] Paywall renders correctly on smallest iPhone (SE) and largest (Pro Max).
- [ ] Force a crash on TestFlight and confirm it doesn't leak PII.
- [ ] Network error states — toggle airplane mode mid-session and verify the app doesn't silently fail.
- [ ] Dark mode — every screen legible (app currently locked to light via `app.json: userInterfaceStyle: "light"`, so this is moot; flag if that changes).

---

## 🟢 GROWTH — not blocking, do before launch if time allows

- [ ] Wire `expo-store-review` to fire after a completed session (not on app open). Cap at system default.
- [ ] Create a `veradicai.com/students` landing page. Set it as the Marketing URL in ASC.
- [ ] Sign up for AppTweak or Sensor Tower free trial and validate keyword volume for all terms in `plans/app-store-listing.md`.
- [ ] Draft a social media launch post and line up 3-5 testimonials from existing web users.
- [ ] Set up a Slack / email alert when a 1★ review comes in (Appbot or RevenueCat's built-in).

---

## 📌 Before hitting "Submit for Review"

Run through this final sanity list:

1. [ ] Build number in `mobile/app.json` incremented for any re-submission (EAS does this automatically with `autoIncrement: true`).
2. [ ] IAP products are in **Ready to Submit** status in ASC, and you've attached them to the build on the Version page.
3. [ ] Screenshots uploaded for iPhone 6.7" at minimum.
4. [ ] App Privacy questionnaire completed per `plans/app-store-privacy-disclosures.md`.
5. [ ] Age Rating questionnaire completed per `plans/app-store-listing.md`.
6. [ ] Review Notes pasted per `plans/app-review-notes.md`, demo account confirmed.
7. [ ] Export compliance answered (already pre-filled via `ITSAppUsesNonExemptEncryption: false`).
8. [ ] App Review contact info filled in.
9. [ ] Version Release = **Manually release this version**.

---

## 🔔 REMIND ME

The following placeholder values exist in the repo and must be replaced before the first EAS submit:

- `mobile/eas.json` → `TODO_APPLE_ID@example.com`, `TODO_ASC_APP_ID`, `TODO_APPLE_TEAM_ID`

If these are still present when you run `eas submit -p ios --profile production`, the submit will fail. These are also called out in `plans/app-review-notes.md` and in an inline comment in `eas.json`.
