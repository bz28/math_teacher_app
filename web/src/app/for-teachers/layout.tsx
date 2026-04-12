import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "For Teachers: Why Schools Need Veradic | Veradic AI",
  description:
    "AI chatbots are already in your classrooms — they're just giving away the answers. Veradic is the AI tutor built for teachers: step-by-step guidance, integrity checks, and teacher-controlled content.",
  openGraph: {
    title: "For Teachers | Veradic AI",
    description:
      "AI chatbots are already in your classrooms. Veradic is the AI tutor built for teachers.",
    url: `${SITE_URL}/for-teachers`,
  },
  alternates: {
    canonical: `${SITE_URL}/for-teachers`,
  },
};

export default function ForTeachersLayout({
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
                name: "For Teachers",
                item: `${SITE_URL}/for-teachers`,
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
