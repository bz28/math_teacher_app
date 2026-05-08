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
      // /security and /safety both consolidated into /for-districts,
      // which now carries the full compliance + safety surface for
      // school administrators. Old /security and /safety inbound
      // links redirect to the new home so external bookmarks and
      // Google's index follow the move.
      {
        source: "/security",
        destination: "/for-districts",
        permanent: true,
      },
      {
        source: "/security/:path*",
        destination: "/for-districts",
        permanent: true,
      },
      {
        source: "/safety",
        destination: "/for-districts",
        permanent: true,
      },
      {
        source: "/safety/:path*",
        destination: "/for-districts",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
