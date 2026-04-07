import { Navbar } from "@/components/landing/navbar";
import { FAQ } from "@/components/landing/faq";
import { Footer } from "@/components/landing/footer";

export const metadata = {
  title: "FAQ – Veradic AI",
  description: "Frequently asked questions about Veradic AI.",
};

export default function FAQPage() {
  return (
    <>
      <Navbar />
      <main>
        <FAQ />
      </main>
      <Footer />
    </>
  );
}
