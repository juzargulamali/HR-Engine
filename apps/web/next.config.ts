import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo already has its own docs/ package for this — don't let `next
  // dev` scaffold a competing AGENTS.md/CLAUDE.md on every run.
  agentRules: false,
  // The four scattered "who has access" screens (Users & roles, Sales, Projects and Inventory Access) now live in People & Access. Temporary
  // (not permanent) redirects, so a bookmark or an old link keeps working and nothing is cached as moved forever while the new screen settles.
  async redirects() {
    return [
      { source: "/admin/users", destination: "/people-access", permanent: false },
      { source: "/sales/access", destination: "/people-access", permanent: false },
      { source: "/projects/access", destination: "/people-access", permanent: false },
      { source: "/inventory/access", destination: "/people-access", permanent: false },
    ];
  },
};

export default nextConfig;
