import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Veradic AI — Your AI Math & Science Tutor",
    short_name: "Veradic AI",
    description:
      "Snap a photo or type any problem. Veradic AI breaks it into guided steps you actually understand, then generates unlimited practice until you master it.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAFE",
    theme_color: "#6C5CE7",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
