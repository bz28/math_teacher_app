import { createSubjectOgImage, ogSize } from "@/lib/og-image";

export const alt = "Veradic AI — Your AI Physics Tutor. Step-by-step solutions for mechanics, energy, waves, and more.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSubjectOgImage({
    title: "Your AI Physics Tutor",
    subtitle: "Step-by-step solutions for mechanics, thermodynamics, waves, electricity, and more.",
    url: "veradicai.com/subjects/physics",
    tags: ["Mechanics", "Energy", "Waves", "Electricity"],
    color: "#0984E3",
    colorLight: "#74B9FF",
    bgGradient: ["#0D1F30", "#0D0C14", "#0D2540"],
  });
}
