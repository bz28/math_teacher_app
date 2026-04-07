import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/home", "/learn", "/practice", "/mock-test", "/history", "/account", "/school/teacher", "/pricing/success", "/set-password"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
