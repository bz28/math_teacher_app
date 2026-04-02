/** FAQ data shared between the FAQ component and JSON-LD schema */
export const faqs = [
  {
    question: "How does AI tutoring work?",
    answer:
      "Snap a photo of your homework or type in any math or science problem. Veradic AI breaks it into bite-sized steps and walks you through each one — like having a personal tutor available 24/7. You can ask questions at any step if you get stuck.",
  },
  {
    question: "Can AI help me with my math homework?",
    answer:
      "Absolutely. Veradic AI covers algebra, geometry, calculus, word problems, and more. It doesn't just give you the answer — it teaches you how to solve each step so you actually understand the material and can tackle similar problems on your own.",
  },
  {
    question: "Is Veradic AI free?",
    answer:
      "Yes! Veradic AI has a free tier that gives you daily tutoring sessions and photo scans. If you need unlimited access, affordable weekly and yearly plans are available.",
  },
  {
    question: "What subjects does Veradic AI cover?",
    answer:
      "Currently, Veradic AI supports Mathematics, Physics, and Chemistry. We're actively working on adding more subjects. Within each subject, the AI can handle problems ranging from middle school to university level.",
  },
  {
    question: "How is this different from just getting the answer?",
    answer:
      "Answer engines give you a result you forget in five minutes. Veradic AI decomposes every problem into guided steps, lets you chat with your AI tutor on each step, and then generates unlimited practice variations so you build real mastery — not just a copy-paste habit.",
  },
  {
    question: "Do I need to create an account?",
    answer:
      "Yes, a free account is required so Veradic AI can save your session history, track your progress, and let you resume where you left off. Signing up takes less than 30 seconds.",
  },
  {
    question: "Can my teacher see my progress?",
    answer:
      "If your school uses Veradic AI, your teacher can view class-level analytics and insights to understand where students need extra help. Individual student data is always kept private and used only to improve your learning experience.",
  },
];

/** JSON-LD for FAQPage schema */
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
