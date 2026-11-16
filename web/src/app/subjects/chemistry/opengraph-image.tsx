import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Chemistry for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOgImage({
    title: "AI chemistry for classrooms",
    subtitle: "Students explain their own steps. Drafted by your rules, approved by you.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/chemistry`,
    board: {
      problem: "H₂ + O₂ → H₂O",
      ask: "Count the oxygens on each side. Do they match?",
      reply: "no, 2 and 1. so 2H₂O",
    },
  });
}
