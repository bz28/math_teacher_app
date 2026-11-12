import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Book a Demo",
  description:
    "See Veradic on your own chapter: a 20-minute call with the team that builds it. Bring a chapter you're teaching and we'll run it live.",
  openGraph: {
    title: "Book a Demo | Veradic AI",
    description:
      "See Veradic on your own chapter. A 20-minute call; bring a chapter you're teaching and we'll run it live.",
    url: `${SITE_URL}/demo`,
  },
  twitter: {
    title: "Book a Demo | Veradic AI",
    description:
      "See Veradic on your own chapter. A 20-minute call; bring a chapter you're teaching and we'll run it live.",
  },
  alternates: {
    canonical: `${SITE_URL}/demo`,
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: SITE_URL,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Book a Demo",
                item: `${SITE_URL}/demo`,
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
