import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence the "multiple lockfiles" warning — we control the root
  outputFileTracingRoot: path.join(__dirname),

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
