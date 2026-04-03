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
    default: "Veradic AI — Your AI Math & Science Tutor",
    template: "%s | Veradic AI",
  },
  description:
    "Snap a photo or type any problem. Veradic AI breaks it into guided steps you actually understand, then generates unlimited practice until you master it.",
  metadataBase: new URL("https://veradicai.com"),
  keywords: [
    "AI tutor",
    "math tutor",
    "science tutor",
    "step-by-step learning",
    "AI homework help",
    "math solver",
    "physics tutor",
    "chemistry tutor",
    "practice problems",
    "exam prep",
    "AI education",
    "Veradic AI",
    "Veradic",
    "veradicai",
  ],
  authors: [{ name: "Veradic AI" }],
  creator: "Veradic AI",
  publisher: "Veradic AI",
  applicationName: "Veradic AI",
  category: "Education",
  openGraph: {
    title: "Veradic AI — Snap. Learn. Master.",
    description:
      "Your AI tutor that breaks any math or science problem into steps you actually understand.",
    url: "https://veradicai.com",
    siteName: "Veradic AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Veradic AI — Snap. Learn. Master.",
    description:
      "Your AI tutor that breaks any math or science problem into steps you actually understand.",
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
                "Veradic AI is an AI-powered tutoring platform that breaks any math or science problem into guided steps you actually understand.",
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("veradic-theme")||"system";var d=t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light":t;if(d==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`,
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
