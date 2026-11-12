import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";

/** Subject pages share the homepage's notebook look: graph paper under everything. */
export default function SubjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="site graph-paper flex min-h-full flex-1 flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
