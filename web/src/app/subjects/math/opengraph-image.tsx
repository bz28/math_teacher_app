import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Math for classrooms. Students explain their own steps; grades are drafted by your rules and approved by you. Shown on a chalkboard: Veradic asks a student how they got from 22 to 15 in 3x + 7 = 22.";
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
