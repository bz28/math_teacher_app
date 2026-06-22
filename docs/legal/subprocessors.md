# Subprocessors

**Version:** 1.0
**Last reviewed:** May 23, 2026

Veradic LLC engages a small number of third-party service providers ("Subprocessors") to operate the platform. This page identifies each Subprocessor, the purpose of the engagement, and the categories of data the Subprocessor may process on Veradic's behalf.

This list is provided to support school district procurement and Data Privacy Agreement (DPA) requirements, including state-specific addenda (e.g., New York Education Law §2-d, California SOPIPA, Illinois SOPPA) that require disclosure of named subprocessors.

---

## Current Subprocessors

| Subprocessor | Purpose | Data categories | Region |
|---|---|---|---|
| **Anthropic, PBC** | AI inference for tutoring, grading assistance, integrity review, and content generation | Problem content, conversation context, and minimal user identifiers required for rate limiting. **Not** used by Anthropic to train models per its commercial Terms of Service. | United States |
| **Railway Corp.** | Application hosting and managed Postgres database | All Veradic application data, including account information, sessions, assignments, submissions, and audit logs. Encrypted at rest. | United States |
| **Vercel, Inc.** | Web frontend hosting and edge delivery (Next.js application) | Page-load telemetry, request logs. Does not store student-generated content. | United States |
| **Resend** | Transactional email delivery (password reset, account notifications, MFA codes) | Recipient email address, email content. | United States |
| **Stripe, Inc.** | Subscription billing for teacher-tier paid plans | Email, name, payment method (Stripe-tokenized; Veradic does not see card numbers). | United States |
| **RevenueCat, Inc.** | Subscription management for mobile app store purchases | App store user identifier, subscription state. Does not handle student work. | United States |
| **Sentry (Functional Software, Inc.)** | Error monitoring and performance telemetry | Stack traces, request identifiers, environment metadata. Student-generated content is not intentionally captured. | United States |

---

## How Subprocessors Are Selected

Veradic selects subprocessors based on:

- Demonstrated security and compliance posture (independent certifications such as SOC 2 or ISO 27001 where applicable)
- Alignment with U.S. education-sector privacy requirements (FERPA, COPPA)
- Contractual commitments restricting use of customer data
- Operational reliability and support quality

Each subprocessor is bound by its own terms of service that limit use of customer data to providing the contracted service.

---

## Changes to Subprocessors

Veradic may add, remove, or change subprocessors as the platform evolves. Where a district has executed a Data Privacy Agreement that requires advance notice of subprocessor changes, Veradic will provide such notice in accordance with that agreement. The most current list of subprocessors is always available at this URL and on request from support@veradicai.com.

---

## Contact

To request additional detail about any subprocessor, request a copy of subprocessor terms applicable to Veradic, or to ask about subprocessor changes:

**Email:** support@veradicai.com
