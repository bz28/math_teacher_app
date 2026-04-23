# App Privacy Disclosures — Veradic iOS

Exact answers for the **App Privacy** nutrition label in App Store Connect. The form is multi-step: for each data type, declare whether you collect it, whether it's linked to identity, and what you use it for.

---

## Data Linked to User

### Contact Info

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| Email Address | Yes | App Functionality, Customer Support | Yes | No |
| Name | Yes | App Functionality | Yes | No |
| Phone Number | No | — | — | — |
| Physical Address | No | — | — | — |
| Other Contact Info | No | — | — | — |

### User Content

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| Photos or Videos | Yes | App Functionality | Yes | No |
| Audio Data | No | — | — | — |
| Gameplay Content | No | — | — | — |
| Customer Support | Yes | Customer Support | Yes | No |
| Other User Content | Yes | App Functionality | Yes | No |

Explain on the form: "Photos = problem/worksheet scans + handwritten work images. Other = typed problem statements, student responses to questions, chat messages with the AI tutor."

### Identifiers

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| User ID | Yes | App Functionality | Yes | No |
| Device ID | No | — | — | — |

### Purchases

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| Purchase History | Yes | App Functionality | Yes | No |

Handled via RevenueCat. Purchase *amounts* and card numbers are never touched by Veradic — that's Apple.

### Usage Data

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| Product Interaction | Yes | App Functionality | Yes | No |
| Advertising Data | No | — | — | — |
| Other Usage Data | No | — | — | — |

"Product Interaction" covers session counts, scan counts, chat counts — used server-side for usage limits and entitlement enforcement. **If you add PostHog / Amplitude / Firebase before launch, update this to include Analytics as a purpose.**

### Diagnostics

Currently none collected. If Sentry mobile is wired up before launch, declare:

| Subtype | Collected | Used For | Linked to Identity | Tracking |
|---|---|---|---|---|
| Crash Data | TBD | Analytics | No | No |
| Performance Data | TBD | Analytics | No | No |
| Other Diagnostic Data | TBD | Analytics | No | No |

## Data NOT Collected

Explicitly answer "Not Collected" for:
- Health & Fitness
- Financial Info (Apple handles card data, not us)
- Location (precise or coarse)
- Sensitive Info
- Contacts
- Search History
- Browsing History

## Tracking

Answer **No** to every "Used for Tracking You" question. Veradic does not track users across other companies' apps or websites.

## Privacy Policy URL

`https://veradicai.com/privacy`

---

## Third-Party Services Disclosure

This doesn't go in the App Privacy label but should be mentioned in the privacy policy (already is, as of `web/src/app/(legal)/privacy/page.tsx`):

| Service | Purpose | Data Sent |
|---|---|---|
| Anthropic (Claude API) | AI tutoring generation | Problem text, student responses, chat messages, photos of work |
| Railway | API + database hosting | All user data |
| RevenueCat | Subscription management | Purchase events, user ID |
| Apple App Store | Payment processing | Transaction data (Apple's scope, not ours) |

---

## Sanity Checks Before Submitting the Form

- [ ] No analytics SDK has snuck in — grep for `posthog|amplitude|firebase|mixpanel` in `mobile/src`.
- [ ] No ad SDK — grep for `AppLovin|AdMob|Unity Ads`.
- [ ] Privacy policy URL loads on mobile Safari.
- [ ] Privacy policy mentions all the data types declared here.
- [ ] If any under-13 capability is ever added, come back and check "Data from Kids" for every applicable row.
