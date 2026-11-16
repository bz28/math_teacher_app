import { createOgImage, ogSize } from "@/lib/og-image";
import { SITE_URL } from "@/lib/seo";

export const alt =
  "Veradic AI: AI can give students the answer. Veradic helps them understand it.";
export const size = ogSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createOgImage({
    title: "AI can give them the answer. Veradic helps them understand it.",
    subtitle: "Students explain their own homework. Teachers approve every grade.",
    url: SITE_URL.replace(/^https?:\/\//, ""),
    board: {
      problem: "3x + 7 = 22",
      ask: "Right answer. How did you get from 22 to 15?",
      reply: "oh, subtract 7! 22 − 7 = 15",
    },
  });
}
