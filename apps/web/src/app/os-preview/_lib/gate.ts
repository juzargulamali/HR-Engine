/**
 * The ENGINIOUS OS design preview is sample-data-only and must never be
 * reachable in Production. It fails closed: it is shown on Vercel preview
 * deployments and in local development/test builds, and hidden everywhere
 * else (including any production build that does not opt in explicitly).
 */
export function isOsPreviewEnabled(env: { VERCEL_ENV?: string; NODE_ENV?: string; OS_PREVIEW_ENABLED?: string }): boolean {
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview") return true;
  if (env.OS_PREVIEW_ENABLED === "1") return true;
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}
