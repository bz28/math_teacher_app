import { createSubjectOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Physics for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "AI physics for classrooms",
    subtitle: "Reads every step of handwritten homework. Drafts the grade from your rules. You approve it.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/physics`,
    tags: ["Mechanics", "Energy", "Waves", "Electricity"],
    color: "#0984E3",
    colorLight: "#74B9FF",
    bgGradient: ["#0D1F30", "#0D0C14", "#0D2540"],
  });
}
