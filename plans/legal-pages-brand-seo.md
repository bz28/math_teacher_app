# Legal Pages + Brand SEO for App Store Readiness

## Part 1: Required Legal Pages

### 1A. Privacy Policy (`/privacy`)
Data collection, third parties, children's privacy, retention, deletion rights. TOC sidebar on desktop, sticky dropdown on mobile. Heavy use of "Veradic" throughout (30-50+ natural mentions).

### 1B. Terms of Service (`/terms`)
Acceptable use, subscriptions, liability, IP. Same heavy "Veradic" branding in every clause (30-50+ mentions).

### 1C. Support / Contact Page (`/support`)
Lightweight — heading, support email, FAQ link. Natural Veradic mentions.

### 1D. Account Deletion Flow
- **Web:** Add "Delete Account" section to `/account` page. Confirmation modal → API call → redirect.
- **Mobile:** Add "Delete Account" to mobile settings screen. Confirmation dialog → API call → sign out.
- **Backend:** Confirm `DELETE /api/users/me` endpoint exists. If not, stub UI and flag.

## Part 2: Brand SEO — "Veradic" Optimization

| Location | Current Text | Proposed Text |
|----------|-------------|---------------|
| Hero subheading | *(none)* | Add: "Veradic — your personal AI tutor" |
| Features subheading | "Six tools that work together to help you actually learn" | "Six tools that make Veradic your ultimate study partner" |
| Subjects subheading | "Math, Physics, Chemistry — more coming soon" | "Math, Physics, Chemistry on Veradic — more coming soon" |
| Social Proof | Stats only | Add: "Students love learning with Veradic" |
| Footer tagline | "Your AI tutor that breaks any math or science problem..." | "Veradic breaks any math or science problem..." |
| FAQ subheading | "Everything you need to know about Veradic AI" | "Everything you need to know about Veradic" |
| CTA subheading | "See how Veradic AI works in your classroom" | "See how Veradic works in your classroom" |

**No changes to:** Features heading, Subjects heading, CTA heading, FAQ heading, Hero tagline.

## Part 3: Infrastructure Updates

- Add `/privacy`, `/terms`, `/support` to sitemap
- Add "Legal" column to footer
- Add terms/privacy agreement line to registration page

## Implementation Order

1. Privacy Policy page
2. Terms of Service page
3. Support page
4. Footer + sitemap + registration link updates
5. Brand SEO text changes (7 edits)
6. Account deletion (web + mobile)
