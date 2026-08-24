import type { Metadata } from "next";
import { Inter, Instrument_Serif, Fraunces, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AuthProvider } from "@/components/auth/auth-provider";
import ServiceStatusBanner from "@/components/service-status-banner";
import ErrorReporting from "@/components/error-reporting";
import { MotionConfig } from "framer-motion";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Editorial display face — used by .font-serif for headline emphasis
// phrases and italic subtitles. The dashboard's polish leans heavily on
// this; we adopt the same family so the two apps speak the same voice.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

// Heavier editorial display serif used for high-emphasis headline
// phrases (hero second-line, subject hero second-line). Instrument
// Serif only ships weight 400, which reads as "magazine subhead" —
// too quiet against bold sans first lines on a conversion page.
// Fraunces supports weights through 900 and was designed for display
// use, so we can pair an italic 600 second phrase with a bold first
// phrase and keep the editorial voice without losing punch.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["italic"],
  display: "swap",
});

// Tabular-numeric mono for stats, prices, counters, code surfaces.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Veradic AI: Classroom AI for Schools, Teachers, and Students",
    template: "%s | Veradic AI",
  },
  description:
    "Veradic AI is the classroom AI built for math, physics, and chemistry teachers. Integrity checks measure what students understand, AI grading handles your homework, and endless practice keeps every student moving — all under teacher control.",
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
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
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
                "Veradic AI is the classroom AI built for math, physics, and chemistry teachers. Integrity checks, AI grading, and endless student practice — all under teacher control.",
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
        {/* FAQ JSON-LD is injected per-page on the routes that
            actually render an FAQ — currently /demo, /for-districts,
            and the subject pages. The homepage no longer carries one.
            Routes without an FAQ simply omit the script. */}
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ErrorReporting />
        <ServiceStatusBanner />
        {/* reducedMotion="user" makes every framer-motion animation in the app
            honor prefers-reduced-motion automatically (transforms collapse to
            none; opacity still fades) — one global guard instead of per-component. */}
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </MotionConfig>
        {process.env.VERCEL && <Analytics />}
        {process.env.VERCEL && <SpeedInsights />}
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
