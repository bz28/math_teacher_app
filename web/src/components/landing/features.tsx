"use client";

import { TabbedShowcase } from "./tabbed-showcase";
import {
  AnimatedLearnDemo,
  AnimatedChatDemo,
  AnimatedPracticeDemo,
  getLearnSubstepCount,
  getChatSubstepCount,
  PRACTICE_SUBSTEP_COUNT,
} from "./animated-demo";

export function Features() {
  return (
    <section id="features" className="pb-16 md:pb-24">
      <TabbedShowcase
        heading="Everything You Need to Master Any Topic"
        subheading="Six tools that make Veradic your ultimate study partner"
        features={[
          {
            title: "Step-by-Step Learning",
            description:
              "Every problem is broken into clear, guided steps. The final answer stays hidden until you've worked through each one — building real understanding, not just copying answers.",
            substepCount: getLearnSubstepCount("physics"),
            teaser: "Watch Veradic solve a physics problem step by step",
            render: (n) => <AnimatedLearnDemo subject="physics" visibleCount={n} />,
          },
          {
            title: "Chat With Your Tutor",
            description:
              "Stuck on a step? Ask a question and get a personalized explanation — without revealing future steps or answers. Like having a tutor who meets you exactly where you are.",
            substepCount: getChatSubstepCount("chemistry"),
            teaser: "See the AI tutor explain a chemistry concept",
            render: (n) => <AnimatedChatDemo subject="chemistry" visibleCount={n} />,
          },
          {
            title: "Practice Until You Master It",
            description:
              "After learning a problem, AI generates similar ones so you can practice the same concept until it sticks. Work through as many as you need — every problem is new, every answer is checked.",
            substepCount: PRACTICE_SUBSTEP_COUNT,
            teaser: "AI generates similar problems for mastery",
            render: (n) => <AnimatedPracticeDemo visibleCount={n} />,
          },
        ]}
      />
    </section>
  );
}
