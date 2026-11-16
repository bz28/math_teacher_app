import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Chemistry for classrooms. Students explain their own steps; grades are drafted by your rules and approved by you. Shown on a chalkboard: Veradic asks a student to count each atom, and they balance 2H₂ + O₂ → 2H₂O.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOgImage({
    title: "AI chemistry for classrooms",
    subtitle: "Students explain their own steps. Drafted by your rules, approved by you.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/chemistry`,
    board: {
      problem: "H₂ + O₂ → H₂O",
      ask: "Count each kind of atom on both sides. What has to change?",
      reply: "2H₂O, then 2H₂. so 2H₂ + O₂ → 2H₂O",
    },
  });
}
