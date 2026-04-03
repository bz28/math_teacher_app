import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";

export default function SubjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main>{children}</main>
      <Footer />
    </>
  );
}
