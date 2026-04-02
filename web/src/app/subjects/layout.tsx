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

/** Breadcrumb JSON-LD helper for subject pages */
export function subjectBreadcrumbJsonLd(name: string, slug: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://veradicai.com",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: `${name} Tutor`,
        item: `https://veradicai.com/subjects/${slug}`,
      },
    ],
  };
}
