import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
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
  openGraph: {
    title: "Veradic AI — Snap. Learn. Master.",
    description:
      "Your AI tutor that breaks any problem into steps you actually understand.",
    url: "https://veradicai.com",
    siteName: "Veradic AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Veradic AI — Snap. Learn. Master.",
    description:
      "Your AI tutor that breaks any problem into steps you actually understand.",
  },
  robots: {
    index: true,
    follow: true,
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
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("veradic-theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
