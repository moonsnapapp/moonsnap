import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile shared packages from the monorepo
  transpilePackages: ["@moonsnap/ui"],
};

export default nextConfig;
