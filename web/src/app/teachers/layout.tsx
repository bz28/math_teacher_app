import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "For Schools & Teachers",
  description:
    "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
  openGraph: {
    title: "Veradic AI — AI-Powered Tutoring for Your Classroom",
    description:
      "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
    url: `${SITE_URL}/teachers`,
  },
  twitter: {
    title: "Veradic AI — AI-Powered Tutoring for Your Classroom",
    description:
      "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
  },
  alternates: {
    canonical: `${SITE_URL}/teachers`,
  },
};

export default function TeachersLayout({
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
                name: "For Schools & Teachers",
                item: `${SITE_URL}/teachers`,
              },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
