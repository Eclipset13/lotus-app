import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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