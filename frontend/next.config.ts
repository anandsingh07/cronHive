import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL || "http://localhost:4000";
    return [
      {
        source: "/jobs/:path*",
        destination: `${apiUrl}/jobs/:path*`,
      },
      {
        source: "/socket.io/:path*",
        destination: `${apiUrl}/socket.io/:path*`,
      }
    ];
  },
};

export default nextConfig;
