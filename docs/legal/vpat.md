# Voluntary Product Accessibility Template (VPAT) — Veradic AI

**Product Name:** Veradic AI Web Platform
**Product Version:** As deployed at https://veradicai.com
**Vendor:** Veradic LLC
**Report Date:** May 23, 2026
**VPAT Version:** 2.4 INT (short-form)
**Contact:** support@veradicai.com

---

## About This Document

This Voluntary Product Accessibility Template ("VPAT") documents Veradic's conformance with the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA, the standard most commonly referenced in U.S. education-sector accessibility procurement.

This is a **short-form** VPAT prepared for procurement review. A more detailed VPAT covering each individual success criterion, as well as Section 508 Chapters 4–6 and EN 301 549, is available on request from support@veradicai.com.

**Important:** This VPAT reflects Veradic's self-assessment of platform conformance as of the report date. Veradic has not engaged a third-party accessibility auditor. Conformance levels marked "Partially Supports" or "Not Evaluated" indicate areas of ongoing work. We provide this VPAT in good faith and welcome feedback to help us improve.

---

## Conformance Level Definitions

- **Supports** — The functionality of the product has at least one method that meets the criterion without known defects or meets it with equivalent facilitation.
- **Partially Supports** — Some functionality of the product does not meet the criterion.
- **Does Not Support** — The majority of product functionality does not meet the criterion.
- **Not Applicable** — The criterion is not relevant to the product.
- **Not Evaluated** — The product has not been evaluated against the criterion. This is permitted in WCAG 2.1 Level AAA conformance only and noted here for transparency at AA where formal testing is pending.

---

## WCAG 2.1 — Level A

### Principle 1: Perceivable

| Criterion | Conformance | Remarks |
|---|---|---|
| 1.1.1 Non-text Content | Partially Supports | Alternative text is provided for many images. Coverage across all visual content is not yet exhaustive; work is ongoing to expand alt-text to all images in teacher grading and student workflow surfaces. |
| 1.2.1 Audio-only and Video-only | Not Applicable | The product does not include pre-recorded audio-only or video-only content. |
| 1.2.2 Captions (Prerecorded) | Not Applicable | The product does not include prerecorded multimedia. |
| 1.2.3 Audio Description or Media Alternative | Not Applicable | The product does not include prerecorded multimedia. |
| 1.3.1 Info and Relationships | Supports | Semantic HTML is used throughout. Form inputs are associated with labels via `htmlFor` / `id` linkage. |
| 1.3.2 Meaningful Sequence | Supports | Content is presented in a meaningful DOM order. |
| 1.3.3 Sensory Characteristics | Supports | Instructions do not rely solely on sensory characteristics such as shape, color, or position. |
| 1.4.1 Use of Color | Partially Supports | Color is not the sole means of conveying information in primary flows. A full audit across all states (e.g., error, warning, success) is pending. |
| 1.4.2 Audio Control | Not Applicable | The product does not auto-play audio. |

### Principle 2: Operable

| Criterion | Conformance | Remarks |
|---|---|---|
| 2.1.1 Keyboard | Supports | All primary interactive functionality is operable via keyboard. |
| 2.1.2 No Keyboard Trap | Supports | Modal dialogs implement focus trapping with managed Escape-to-close behavior and focus restoration. No unintended keyboard traps are known. |
| 2.1.4 Character Key Shortcuts | Not Applicable | The product does not implement single-character keyboard shortcuts. |
| 2.2.1 Timing Adjustable | Partially Supports | Most product functionality does not impose user-side time limits. Where time-bounded interactions exist (e.g., authentication session expiry), users can extend through re-authentication. |
| 2.2.2 Pause, Stop, Hide | Not Applicable | The product does not include moving, blinking, or auto-updating content. |
| 2.3.1 Three Flashes or Below Threshold | Supports | The product does not contain content that flashes more than three times per second. |
| 2.4.1 Bypass Blocks | Does Not Support | Skip-navigation links are not yet implemented. This is a known gap and is on the accessibility roadmap. |
| 2.4.2 Page Titled | Supports | Pages have descriptive titles via Next.js metadata. |
| 2.4.3 Focus Order | Supports | Focus order follows the visual reading order of the page. |
| 2.4.4 Link Purpose (In Context) | Supports | Link text describes the destination in context. |
| 2.5.1 Pointer Gestures | Supports | The product does not require multi-point or path-based gestures. |
| 2.5.2 Pointer Cancellation | Supports | Standard browser pointer behavior is used; activation occurs on `up` rather than `down`. |
| 2.5.3 Label in Name | Supports | Accessible names match visible labels. |
| 2.5.4 Motion Actuation | Not Applicable | The product does not respond to device motion. |

### Principle 3: Understandable

| Criterion | Conformance | Remarks |
|---|---|---|
| 3.1.1 Language of Page | Supports | Pages declare a `lang` attribute. |
| 3.2.1 On Focus | Supports | Focusing on an element does not initiate a change of context. |
| 3.2.2 On Input | Supports | Changing the value of a control does not initiate an unexpected change of context. |
| 3.3.1 Error Identification | Supports | Form errors are identified in text adjacent to the input. |
| 3.3.2 Labels or Instructions | Supports | Labels or instructions are provided for user input. |

### Principle 4: Robust

| Criterion | Conformance | Remarks |
|---|---|---|
| 4.1.1 Parsing | Supports | Markup is generated through React; standard parsing applies. |
| 4.1.2 Name, Role, Value | Partially Supports | Standard form controls and semantic elements provide accessible name and role. Custom-styled controls have appropriate ARIA attributes; full audit across all custom components is in progress. |

---

## WCAG 2.1 — Level AA

| Criterion | Conformance | Remarks |
|---|---|---|
| 1.2.4 Captions (Live) | Not Applicable | No live audio content. |
| 1.2.5 Audio Description (Prerecorded) | Not Applicable | No prerecorded video. |
| 1.3.4 Orientation | Supports | Content does not restrict to a single display orientation. |
| 1.3.5 Identify Input Purpose | Partially Supports | Common input types (email, password) use appropriate `autocomplete` attributes. Coverage across all input fields is in progress. |
| 1.4.3 Contrast (Minimum) | Not Evaluated | Color contrast has not been independently validated against the 4.5:1 normal-text / 3:1 large-text thresholds. Contrast validation is part of ongoing accessibility work. |
| 1.4.4 Resize Text | Supports | Text can be resized to 200% via browser zoom without loss of content or functionality. |
| 1.4.5 Images of Text | Supports | Text is rendered as text, not as images, except where presentation is essential (e.g., logos). |
| 1.4.10 Reflow | Partially Supports | The product is responsive across common viewport widths. Behavior at 320 CSS pixels in all flows has not been exhaustively validated. |
| 1.4.11 Non-text Contrast | Not Evaluated | UI component and graphical-object contrast has not been independently validated against the 3:1 threshold. |
| 1.4.12 Text Spacing | Supports | Content adapts to user-applied text-spacing overrides without loss of content. |
| 1.4.13 Content on Hover or Focus | Supports | Hover-triggered content is dismissible, hoverable, and persistent where applicable. |
| 2.4.5 Multiple Ways | Partially Supports | Primary navigation is provided through the site navigation. A site-wide search or sitemap is not yet implemented. |
| 2.4.6 Headings and Labels | Supports | Headings and labels describe topic or purpose. |
| 2.4.7 Focus Visible | Supports | Keyboard focus is visible through browser-default focus indicators and custom styling. |
| 3.1.2 Language of Parts | Not Applicable | All content is in English. |
| 3.2.3 Consistent Navigation | Supports | Navigation is consistent across pages. |
| 3.2.4 Consistent Identification | Supports | Components with the same functionality are identified consistently. |
| 3.3.3 Error Suggestion | Supports | Error messages suggest corrections where the system can identify them. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Account deletion is reversible-on-confirmation; payment flows are handled by third-party processors with standard confirmation. |
| 4.1.3 Status Messages | Partially Supports | Status messages are announced via standard components. ARIA live region coverage across all status surfaces is being audited. |

---

## Section 508 — Summary

Veradic supports the functional performance criteria of Section 508 § E207.2 and is built on WCAG 2.1 conformance work. A criterion-by-criterion Section 508 Chapter 5 (Software) and Chapter 6 (Support Documentation) report is available on request.

---

## Legal Disclaimer

This VPAT is provided in good faith as a description of Veradic's current accessibility posture. It does not constitute a warranty of conformance. Veradic continues to invest in accessibility improvements and will update this VPAT as material changes are made.

For accessibility-related questions, accommodation requests, or to report a barrier:

**Email:** support@veradicai.com
**Public statement:** https://veradicai.com/trust
