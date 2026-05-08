export const SITE_URL = "https://veradicai.com";

/** FAQ data shared between the FAQ component and JSON-LD schema */
export const faqs = [
  {
    question: "How do you stop students from cheating?",
    answer:
      "Every homework submission goes through Veradic's conversational integrity agent. After a student submits, the AI asks them follow-up questions about the specific steps in their own work — easy to answer if they did it, hard if they didn't. You see the conversation and an integrity score, and you make the final call. The AI itself is also built to guide rather than answer, so it won't drop solutions on demand even when students push for them.",
  },
  {
    question: "Will you meet our district's data privacy requirements?",
    answer:
      "Veradic complies with FERPA as a school official acting under your district's direction, and with COPPA via the school consent exception used by all classroom-deployed ed-tech. Student work is treated as an education record, kept under school control, and never used to train AI models. We sign Data Processing Agreements — including the NDPA template most US districts use — and can work through state-specific addenda (NY Ed Law §2-d, CA SOPIPA, IL SOPPA, etc.) on request. Send us your district's paperwork and we'll work through it.",
  },
  {
    question: "How long until my class is up and running?",
    answer:
      "As fast as you want. Most teachers are running their first homework set within a week — we set up the school account, you organize courses and sections, and students join with a 6-character code (no emails, no paperwork). If you're motivated, you can be live the same day.",
  },
  {
    question: "How is Veradic different from other AI tools?",
    answer:
      "Most AI tools are built to give answers fast. Veradic is built around what teachers actually need: an integrity check on every submission so you know who did the work, AI grading that drafts the grade and waits for your override, and a question bank that generates endless practice variations so every student gets unlimited reps. The student-facing tutor is the engine that powers all of it — designed for classrooms from day one, not a consumer chatbot with a school skin on.",
  },
  {
    question: "Can I try it with just one class first?",
    answer:
      "Yes — we run pilot trials with single classrooms so you can see if it fits before committing anything wider. Email support@veradicai.com and we'll set you up.",
  },
  {
    question: "What can I see about my students?",
    answer:
      "Per assignment: who completed it, who didn't, an integrity score on every submission, the AI-graded breakdown ready for you to override, and the conversational integrity transcript. Across the class: who's struggling on which concepts, week over week.",
  },
];

/** District-specific FAQ — used on /for-districts. Different audience
 *  than the homepage FAQ; questions are about procurement, paperwork,
 *  state laws, and pilot scope rather than classroom workflow. */
export const districtFaqs = [
  {
    question: "What state-specific data privacy laws do you cover?",
    answer:
      "We work through any state addendum your district sends us. We've signed agreements covering NY Education Law §2-d, CA SOPIPA, IL SOPPA, and others. If your state has a custom rider, send it; we'll redline it and return within 5 business days.",
  },
  {
    question: "Can we run a pilot with a single classroom first?",
    answer:
      "Yes. Most districts start by running one teacher with one class for 4-8 weeks before signing district-wide. We set up the school account, the teacher organizes their course, students join with a 6-character code. After the pilot, you decide whether to expand.",
  },
  {
    question: "What does \"data isolation\" actually mean here?",
    answer:
      "Student work, AI conversations, integrity-check transcripts, and grades are scoped to your school account. They are never used to train AI models — ours or any third party's. They are treated as education records under FERPA and remain under your control. You can audit, export, or delete the data at any time.",
  },
  {
    question: "Can we sign our own DPA instead of yours?",
    answer:
      "Yes. We don't require districts to use our paperwork; we work through whatever you use. Send us your standard DPA, we sign it. If you have a custom version, we'll redline it.",
  },
  {
    question: "Do you support SSO?",
    answer:
      "Veradic uses 6-character join codes by default — no SSO project required. SSO integration (Google Workspace for Education, Clever, ClassLink) is on the roadmap; if it's a hard requirement for your district, tell us in the demo and we'll discuss timeline.",
  },
  {
    question: "What does it cost?",
    answer:
      "Pricing is per-student per-year, with district volume tiers and a single-classroom pilot tier. Email us for current rates and a quote scoped to your enrollment.",
  },
  {
    question: "Who runs Veradic?",
    answer:
      "Veradic is a small, independent team building classroom AI from first principles. We're not a side project of a larger AI company; what you see is the entire scope of what we ship.",
  },
];

/** JSON-LD for FAQPage schema. Caller passes the FAQ set the page
 *  actually displays so search engines see the same Q&A the visitor
 *  reads — different routes (homepage vs. /for-districts) render
 *  different FAQs and need their own structured data. */
export function faqJsonLd(items: { question: string; answer: string }[] = faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/** EducationalOccupationalProgram JSON-LD for subject pages */
export function subjectEducationalProgramJsonLd(name: string, slug: string, description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOccupationalProgram",
    name: `Veradic AI ${name} Tutor`,
    description,
    url: `${SITE_URL}/subjects/${slug}`,
    provider: {
      "@type": "Organization",
      name: "Veradic AI",
      url: SITE_URL,
    },
    educationalProgramMode: "online",
    offers: {
      "@type": "Offer",
      category: "Free",
      price: "0",
      priceCurrency: "USD",
    },
  };
}

/** Breadcrumb JSON-LD helper for subject pages */
export function subjectBreadcrumbJsonLd(name: string, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${name} Tutor`,
        item: `${SITE_URL}/subjects/${slug}`,
      },
    ],
  };
}
