import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "For Schools & Teachers",
  description:
    "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
  openGraph: {
    title: "Veradic AI — AI-Powered Tutoring for Your Classroom",
    description:
      "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
    url: "https://veradicai.com/teachers",
  },
  twitter: {
    title: "Veradic AI — AI-Powered Tutoring for Your Classroom",
    description:
      "A personal AI tutor for every student in your classroom: step-by-step guidance at every student's pace, automated grading, endless practice problems, and actionable insights — so you can spend your time where it matters most.",
  },
  alternates: {
    canonical: "https://veradicai.com/teachers",
  },
};

export default function TeachersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
