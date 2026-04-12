import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Book a Demo",
  description:
    "Bring Veradic AI to your classroom. 20-minute demo, no pitch, no pressure. We'll show you exactly how it fits your curriculum.",
  openGraph: {
    title: "Book a Demo | Veradic AI",
    description:
      "Bring Veradic AI to your classroom. 20-minute demo, no pitch, no pressure.",
    url: `${SITE_URL}/demo`,
  },
  twitter: {
    title: "Book a Demo | Veradic AI",
    description:
      "Bring Veradic AI to your classroom. 20-minute demo, no pitch, no pressure.",
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
