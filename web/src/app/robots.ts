import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/home", "/learn", "/practice", "/mock-test", "/history", "/account", "/teacher", "/pricing/success", "/set-password"],
      },
    ],
    sitemap: "https://veradicai.com/sitemap.xml",
  };
}
