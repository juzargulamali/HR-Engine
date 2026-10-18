/**
 * Settings the application cannot start without. The proxy runs before every page and API route and creates a Supabase
 * client from the first two, so when either is missing every request used to end in a bare "Internal Server Error" with the
 * real reason only deep in the runtime log. This names the missing settings (never their values) so the failure explains itself.
 * It fails closed: nothing here lets anyone in; it only changes what an unconfigured deployment says.
 */
export const REQUIRED_PUBLIC_SETTINGS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

export function missingSettings(values: Record<string, string | undefined>): string[] {
  return REQUIRED_PUBLIC_SETTINGS.filter((name) => !values[name] || values[name]!.trim() === "");
}

/** A plain page for an unconfigured deployment. Lists names only. */
export function configurationErrorPage(missing: readonly string[]): string {
  const items = missing.map((m) => `<li><code>${m}</code></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not configured · ENGINIOUS OS</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#10191c;color:#e8f0f0"><main style="max-width:30rem;padding:24px"><h1 style="font-size:1.25rem;margin:0 0 .75rem">This deployment is not configured</h1><p style="margin:0 0 .75rem;line-height:1.5;color:#b3c3c7">ENGINIOUS OS cannot sign anyone in here because these settings are missing from this Vercel environment:</p><ul style="line-height:1.6">${items}</ul><p style="margin:.75rem 0 0;line-height:1.5;color:#b3c3c7">Nothing was bypassed: sign-in and every page stay unavailable until they are set. In Vercel, open Project &rarr; Settings &rarr; Environment Variables, make sure they are enabled for this environment (Production, Preview), then redeploy.</p></main></body></html>`;
}
