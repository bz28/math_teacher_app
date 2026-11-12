import { createSubjectOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI: Chemistry for classrooms. Handwritten homework read step by step, graded by your rules, approved by you.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "AI chemistry for classrooms",
    subtitle: "Reads every step of handwritten homework. Drafts the grade from your rules. You approve it.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/chemistry`,
    tags: ["Reactions", "Stoichiometry", "Acids & Bases", "Organic"],
    color: "#00B894",
    colorLight: "#55EFC4",
    bgGradient: ["#0D2B22", "#0D0C14", "#0D3028"],
  });
}
