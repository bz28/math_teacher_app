import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Physics for classrooms. Students explain their own steps; grades are drafted by your rules and approved by you. Shown on a chalkboard: Veradic asks what units 72 km/h needs to be in, and the student converts it to 20 m/s.";
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
