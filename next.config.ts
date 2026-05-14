import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // /admin/upload accepts PDFs up to 12 MB (default cap is 1 MB).
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
