import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. An empty package-lock.json in the parent directory
    // (C:\Users\kbeni) otherwise makes Next infer the home directory as the root,
    // which would trace files from outside this project.
    root: import.meta.dirname,
  },
};

export default nextConfig;
