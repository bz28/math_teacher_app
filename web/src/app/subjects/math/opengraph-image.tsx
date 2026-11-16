import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Math for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOgImage({
    title: "AI math for classrooms",
    subtitle: "Students explain their own steps. Drafted by your rules, approved by you.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/math`,
    board: {
      problem: "3x + 7 = 22",
      ask: "How did you get from 22 to 15?",
      reply: "took 7 off both sides",
    },
  });
}
