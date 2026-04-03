import { createSubjectOgImage, ogSize } from "@/lib/og-image";

export const alt = "Veradic AI — Your AI Chemistry Tutor. Step-by-step solutions for reactions, stoichiometry, and more.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "Your AI Chemistry Tutor",
    subtitle: "Step-by-step solutions for reactions, stoichiometry, organic chemistry, and more.",
    url: "veradicai.com/subjects/chemistry",
    tags: ["Reactions", "Stoichiometry", "Acids & Bases", "Organic"],
    color: "#00B894",
    colorLight: "#55EFC4",
    bgGradient: ["#0D2B22", "#0D0C14", "#0D3028"],
  });
}
