import { createSubjectOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt = "Veradic AI — Your AI Math Tutor. Step-by-step solutions for algebra, calculus, and more.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "Your AI Math Tutor",
    subtitle: "Step-by-step solutions for algebra, calculus, geometry, word problems, and more.",
    url: `${SITE_URL.replace(/^https?:\/\//, "")}/subjects/math`,
    tags: ["Algebra", "Calculus", "Geometry", "Word Problems"],
    color: "#0E5238",
    colorLight: "#5BC298",
    bgGradient: ["#102018", "#0D0C14", "#0A2418"],
  });
}
