import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Physics for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOgImage({
    title: "AI physics for classrooms",
    subtitle: "Students explain their own steps. Drafted by your rules, approved by you.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/physics`,
    board: {
      problem: "72 km/h → 4.0 s",
      ask: "What units does 72 need to be in first?",
      reply: "oh, m/s! that’s 20 m/s",
    },
  });
}
