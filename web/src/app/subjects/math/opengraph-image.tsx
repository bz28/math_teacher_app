import { createSubjectOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Math for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "AI math for classrooms",
    subtitle: "Reads every step of handwritten homework. Drafts the grade from your rules. You approve it.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/math`,
    tags: ["Algebra", "Calculus", "Geometry", "Word Problems"],
    color: "#0E5238",
    colorLight: "#5BC298",
    bgGradient: ["#102018", "#0D0C14", "#0A2418"],
  });
}
