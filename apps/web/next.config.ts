import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile shared packages from the monorepo
  transpilePackages: ["@snapit/ui"],
};

export default nextConfig;
