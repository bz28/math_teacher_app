import { createSubjectOgImage, ogSize } from "@/lib/og-image";

export const alt = "Veradic AI — Your AI Math Tutor. Step-by-step solutions for algebra, calculus, and more.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "Your AI Math Tutor",
    subtitle: "Step-by-step solutions for algebra, calculus, geometry, word problems, and more.",
    url: "veradicai.com/subjects/math",
    tags: ["Algebra", "Calculus", "Geometry", "Word Problems"],
    color: "#6C5CE7",
    colorLight: "#A29BFE",
    bgGradient: ["#1A1630", "#0D0C14", "#1C1040"],
  });
}
