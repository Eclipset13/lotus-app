import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 10 MiB file limit plus multipart field/boundary overhead.
      bodySizeLimit: "11mb",
    },
  },
  async rewrites() {
    return [
      {
        source: "/constructor",
        destination: "/bouquet-builder",
      },
    ];
  },
};

export default nextConfig;
