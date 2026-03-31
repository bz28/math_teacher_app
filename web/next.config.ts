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
};

export default nextConfig;
