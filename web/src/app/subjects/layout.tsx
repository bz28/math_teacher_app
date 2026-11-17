import { SkipToMainLink } from "@/components/shared/skip-to-main-link";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";

/** Subject pages share the homepage's look, nav and footer. */
export default function SubjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="site site-page flex min-h-full flex-1 flex-col">
      <SkipToMainLink />
      <Navbar />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
