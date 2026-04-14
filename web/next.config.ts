import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy API requests in development to avoid CORS issues
  async rewrites() {
    return process.env.NEXT_PUBLIC_API_URL
      ? [
          {
            source: "/api/proxy/:path*",
            destination: `${process.env.NEXT_PUBLIC_API_URL}/:path*`,
          },
        ]
      : [];
  },
  // Permanent redirects for renamed marketing routes
  async redirects() {
    return [
      // /teachers was the old long-form teacher pitch; it's now just the
      // book-a-demo page at /demo. Teacher-facing content moved to the
      // homepage. 308 permanent so existing links and Google's index
      // transfer.
      {
        source: "/teachers",
        destination: "/demo",
        permanent: true,
      },
      {
        source: "/teachers/:path*",
        destination: "/demo",
        permanent: true,
      },
      // /security was renamed to /safety — the page covers student
      // safety, data privacy, and classroom-specific protections, and
      // "safety" is the native term for schools. "Security" is narrowly
      // technical; "safety" matches the page's own headline ("Built to
      // be safe in schools").
      {
        source: "/security",
        destination: "/safety",
        permanent: true,
      },
      {
        source: "/security/:path*",
        destination: "/safety",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
