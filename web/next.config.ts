import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Proxy API requests in development to avoid CORS issues.
    const apiProxy = process.env.NEXT_PUBLIC_API_URL
      ? [
          {
            source: "/api/proxy/:path*",
            destination: `${process.env.NEXT_PUBLIC_API_URL}/:path*`,
          },
        ]
      : [];

    return {
      beforeFiles: [],
      afterFiles: apiProxy,
      fallback: [],
    };
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
      // /tour used to mount the buyer pitch site (demo/) under
      // veradicai.com/tour. It's off the public site now: its deep-dives
      // walk through how integrity signals and grading work — sales
      // material, not something a student browsing veradicai.com should
      // be reading. The pitch site still lives standalone at
      // demo.veradicai.com, which is where sales links point. 308 so
      // existing /tour links land on book-a-demo instead of a 404.
      {
        source: "/tour",
        destination: "/demo",
        permanent: true,
      },
      {
        source: "/tour/:path*",
        destination: "/demo",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
