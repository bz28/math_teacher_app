import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { faqJsonLd } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Veradic AI: AI Tutor for Schools, Teachers, and Students",
    template: "%s | Veradic AI",
  },
  description:
    "Veradic AI is the AI tutor built for classrooms. Guides students through math, physics, and chemistry step by step, without ever giving the answer away. Teacher-controlled content, integrity checks, and safe classroom deployment.",
  metadataBase: new URL("https://veradicai.com"),
  keywords: [
    "ai tutor for schools",
    "ai math tutor for schools",
    "ai physics tutor for schools",
    "ai chemistry tutor for schools",
    "classroom ai tutor",
    "ai homework help for classrooms",
    "chatgpt alternative for schools",
    "ai tutor that doesn't give answers",
    "integrity checker ai homework",
    "ai tutor for teachers",
    "step by step ai tutor",
    "veradic ai",
    "veradic",
  ],
  authors: [{ name: "Veradic AI" }],
  creator: "Veradic AI",
  publisher: "Veradic AI",
  applicationName: "Veradic AI",
  category: "Education",
  openGraph: {
    title: "Veradic AI: Built for your classroom",
    description:
      "Measures what students understand. Grades their homework. Gives every student endless practice.",
    url: "https://veradicai.com",
    siteName: "Veradic AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Veradic AI: Built for your classroom",
    description:
      "Measures what students understand. Grades their homework. Gives every student endless practice.",
    creator: "@veradicai",
    site: "@veradicai",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://veradicai.com",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Veradic AI",
              alternateName: ["Veradic", "VeradicAI"],
              applicationCategory: "EducationalApplication",
              operatingSystem: "Web, iOS, Android",
              url: "https://veradicai.com",
              description:
                "Veradic AI is the AI tutor built for classrooms. Guides students through math, physics, and chemistry step by step, without ever giving the answer away.",
              audience: {
                "@type": "EducationalAudience",
                educationalRole: ["teacher", "student", "school administrator"],
              },
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free tier available",
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Veradic AI",
              alternateName: "Veradic",
              url: "https://veradicai.com",
              logo: "https://veradicai.com/icon.svg",
              sameAs: ["https://twitter.com/veradicai"],
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Veradic AI",
              alternateName: "Veradic",
              url: "https://veradicai.com",
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqJsonLd()),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
        <Analytics />
        <SpeedInsights />
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
