import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo already has its own docs/ package for this — don't let `next
  // dev` scaffold a competing AGENTS.md/CLAUDE.md on every run.
  agentRules: false,
  // Sales & CRM accepts files up to 20 MB (validated again on the server, see lib/actions/crmFiles.ts); the default
  // 1 MB server-action body limit would otherwise reject them before they reach that validation.
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
};

export default nextConfig;
