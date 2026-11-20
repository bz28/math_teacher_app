# Veradic — Teacher Guide

**Version:** 1.0
**Last updated:** November 19, 2026

This guide walks you through using Veradic in your classroom. It's the document we share with new teachers during onboarding and with district professional-development coordinators evaluating Veradic for school-wide rollout.

If you have questions not answered here, contact **support@veradicai.com**.

---

## What Veradic is

Veradic is a teacher-facing AI platform for math, physics, and chemistry classrooms. It does three things:

1. **Generates problems** — unlimited grade-appropriate practice tied to the topics you teach.
2. **Grades homework** — applies your rubric to student submissions, surfaces final scores you can publish or override.
3. **Surfaces integrity concerns** — opens a guided conversation with students whose work suggests a misunderstanding or possible academic-integrity issue. The conversation is the starting point; the teacher always makes the final determination.

Veradic does not replace the teacher. Every grade, integrity decision, and student-facing message is under your control.

---

## Getting started

### 1. Sign in

Your account was created from your district's invite. Sign in at **veradicai.com/login** with the email used in the invite.

If your district has enabled two-factor authentication, you'll receive a 6-digit code by email after entering your password. Codes expire after 10 minutes; if you don't receive one, check spam or request a new sign-in.

### 2. Set up your first course

From **My Courses**, click **New Course** and give it a name, subject, and (optionally) grade level — one course per subject you teach (e.g., "Algebra 1"). Inside the course, open the **Sections** tab and add a section for each class period (e.g., "Period 3"). Materials and homework live on the course, so every section shares them; when you create homework you choose which sections receive it.

### 3. Add your students

Two ways:

- **Join code** — every section card shows a short code under "Share with your class" (click to copy). Students enter it when they sign up at veradicai.com/register. **Close enrollment** sits right beside the code; **Regenerate join code** is in the section's **Manage** panel.
- **Email invites** — paste student emails (up to 100 at a time, comma- or line-separated) into **Invite students** on the section. Students who already have a Veradic account are added to the section right away; everyone else gets an email link to sign up, which lands them in your section. Pending invites can be resent or revoked.

Every student account is created through one of these paths: Veradic has no personal self-signup, so students of any age join through their teacher's class (which also satisfies the federal COPPA school-consent exception for under-13s).

### 4. Add curriculum materials

Upload your textbook chapters, problem sets, or curriculum documents (PDF up to 25 MB; PNG or JPG up to 5 MB) to the course **Materials** tab. Materials are organized into **units** — think chapters. Create a unit with **New Unit** (or drop a whole folder, which becomes a unit) and upload into it. Every homework belongs to at least one unit. When you generate problems, tick the materials you want Veradic to draw on in the source-material picker, so the problems stay aligned with what you actually teach.

---

## Creating homework

Open a course, click **Homework**, then **New homework**. A four-step form (Details → Problems → Grading → Review) asks for:

- **Title** — what students see (e.g., "Chapter 3 problems 1–10")
- **Units** — required; which unit(s) the homework covers
- **Due date and late policy** — accept any time, −10% per day late, or closed after the due date. **AI grading starts when the due date passes.** With no due date, submissions wait until you press **Grade ungraded** on the grading page.
- **Sections** — which class periods receive it (leave empty for all)
- **Problems** — generate them (pick a count and an optional focus) or upload a worksheet (images or PDFs)
- **Grading** — the point value, plus extra rules and common mistakes to watch for

Generated problems land in a review queue: approve or reject each one (or edit it with the AI Workshop) before publishing. Students see the homework once you click **Publish**; you can **Preview as student** first.

### Tips for good rubrics

The rubric is what the AI uses to grade. Rubrics that work well:

- **Be specific about partial credit.** "1 point for setting up the equation correctly, 1 point for executing the algebra, 1 point for the final answer with units" beats "0–3 points."
- **List common mistakes.** "Often forgets to convert units" helps the AI recognize a typical near-miss and treat it consistently.
- **Use the same language you'd use in class.** The AI follows your conventions.

The AI grading flow shows you a live preview of how each rubric criterion will be applied — adjust your rubric until the preview matches your judgment.

---

## Grading workflow

When students submit work, you'll see new submissions in the **Submissions** tab. AI grading runs once the due date passes (or when you press **Grade ungraded**).

1. Open a homework's grading page. Students are grouped into **Needs your eyes**, **Awaiting grade**, **AI confident**, and **Not submitted**, so the work most worth your attention comes first.
2. Open a submission to see the student's work and the AI's draft grade on each problem, with its reasoning.
3. Adjust any problem to full, partial, or zero credit. The AI is a draft; you are the final authority on every grade. Click **Approve** when a submission is right.
4. Click **Publish** and choose **Publish only approved** or **Publish all** to release grades to students.

Published grades collect in the **Grades** tab, which can be exported as CSV per section or for the whole course.

The platform records who graded what and when. Grades aren't visible to students until you publish.

---

## Integrity workflow

Veradic looks at submitted work for patterns that suggest a student may not have done the work themselves — for example, perfect algebra paired with wrong arithmetic, or a sudden jump to an answer without showing reasoning.

When the AI flags integrity concerns:

1. The student receives a brief follow-up conversation through Veradic. The conversation is framed as "let's check your understanding" — not as an accusation.
2. The student walks through one or two related problems. The AI watches how they respond.
3. The outcome appears on the submission. **Review** means the conversation raised a question you should look at; **Tutored** means the AI had to help the student through it. You can read the full conversation.
4. **The teacher always makes the final call.** Click **Mark reviewed** and record *Cleared — no concern*, *Confirmed concern*, or *Contacted student*. Veradic does not auto-penalize, auto-flag a student as cheating, or take any consequential action without teacher review.

This mirrors the AI policy adopted by RTSD and the district guidance from the Family Educational Rights and Privacy Act's enforcement guidance: AI integrity detection is a starting point for conversation, not sufficient evidence on its own.

---

## AI usage expectations

We recommend communicating your AI expectations to students at the start of the course and on individual assignments. Many districts use a tiered framework adapted from Perkins, Furze, Roe, and MacVaugh (2024):

| Level | Name | Meaning |
|-------|------|---------|
| AI:0 | No AI | This activity is completed entirely without AI assistance. |
| AI:1 | AI Planning & Idea Generation | AI for brainstorming and structure only; no AI content in the final submission. |
| AI:2 | AI Editing & Revision | AI may help refine your own work; no new content created by AI. |
| AI:3 | AI Task Completion | AI may complete certain elements as specified by the teacher. |
| AI:4 | Full AI Use with Human Oversight | AI may be used throughout, with human evaluation of all output. |

You can state the expected level in your syllabus and on each assignment description. Veradic itself is intentionally designed so students cannot get final answers without working through the problem — but pairing platform behavior with stated expectations is the most effective approach.

---

## Subscription tiers

Veradic offers:

- **Free** — limited daily session count for teachers exploring the platform
- **Teacher Pro** — unlimited practice generation for individual teachers, billed monthly or annually
- **School / District** — full classroom features (sections, grading, integrity workflow, district admin dashboard) under a per-school agreement with a signed Data Privacy Agreement

If your district has signed an agreement, you'll have full school access without managing personal billing.

---

## Data & privacy

- Student work is owned by your district and used only to provide the service.
- Veradic does not use student data to train AI models.
- Veradic operates as a "school official" under FERPA. See `/privacy`, `/trust`, and your district's signed Data Privacy Agreement for the full picture.
- You can download a copy of the data Veradic holds about you from your account settings ("Download my data").

---

## Help and support

- **Email:** support@veradicai.com (typical response within one business day)
- **Trust & Security:** https://veradicai.com/trust
- **Privacy Policy:** https://veradicai.com/privacy
- **Terms of Service:** https://veradicai.com/terms

For district administrators evaluating Veradic for school-wide deployment, additional procurement materials (Data Privacy Agreement, Incident Response Policy, VPAT, Subprocessor list) are available on request.
