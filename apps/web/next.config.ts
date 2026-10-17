import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo already has its own docs/ package for this — don't let `next
  // dev` scaffold a competing AGENTS.md/CLAUDE.md on every run.
  agentRules: false,
};

export default nextConfig;
