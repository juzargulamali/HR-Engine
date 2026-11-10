import "server-only";

/**
 * JARVIS configuration, read from the server environment only (nothing here is ever sent to the browser). Every limit is bounded, so a typo cannot disable a control.
 *
 *   JARVIS_DISABLED=1                 hard off: the assistant is unavailable; ordinary Sales & CRM is unaffected
 *   ANTHROPIC_API_KEY                 the provider key (server only; never logged, never sent to the browser). Missing = the assistant is unavailable
 *   JARVIS_MODEL                      default claude-sonnet-5-5 (a product setting: change it without a code release)
 *   JARVIS_PROVIDER                   anthropic | simulated   (simulated is for tests and local runs ONLY and is refused in production, see simulatedAllowed)
 *   JARVIS_CONFIRMATION_SECRET        at least 32 characters; the ONE root secret. Two keys are derived from it: the review key (signs the review tokens the browser holds; only this
 *                                     server knows it) and the proof key (signs the short-lived database proofs; the database holds the same derived key, set with
 *                                     jarvis_set_proof_key from this same value). REQUIRED in production (JARVIS refuses to operate without it)
 *   JARVIS_MAX_INPUT_CHARS            default 6000     the longest brief accepted
 *   JARVIS_MAX_OUTPUT_TOKENS          default 1200     the provider's output cap
 *   JARVIS_TIMEOUT_MS                 default 20000    the provider call limit
 *   JARVIS_DAILY_LIMIT_PER_USER       default 30       provider requests per person per Dubai day (counted in the database)
 *   JARVIS_CONFIRMATION_TTL_MINUTES   default 15       how long a reviewed card can be confirmed (the review token's life)
 *   JARVIS_PROOF_TTL_SECONDS          default 120      how long the database proof issued INSIDE a confirmation request is valid (30 to 600)
 *   JARVIS_PAUSE                      a comma-separated list of what to pause independently: help, lookups, chat, memory, writes (e.g. "chat,lookups"). Unknown words are ignored.
 *                                     Writes also have the database switch (jarvis_settings.writes_enabled); either one pauses them
 *   JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK=1   lets the isolated local test stack (a production build against a loopback database, never on Vercel) use the simulated provider
 */
export const DEFAULT_JARVIS_MODEL = "claude-sonnet-5-5";
const DEV_SECRET = "jarvis-development-only-secret-not-for-production-use";

export interface JarvisConfig {
  disabled: boolean;
  providerKind: "anthropic" | "simulated" | "none";
  /** Why the provider is not usable, in words for the operator (never the key). */
  providerNote: string | null;
  apiKey: string | null;
  model: string;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyLimit: number;
  confirmationTtlMs: number;
  /** Life of the database proof issued inside a confirmation request (short: it is used in the same request). */
  proofTtlMs: number;
  /** null = not configured (in production-like environments the assistant then refuses to operate). */
  confirmationSecret: string | null;
  productionLike: boolean;
  /** What is paused independently of the main switch (JARVIS_PAUSE). */
  paused: ("help" | "lookups" | "chat" | "memory" | "writes")[];
}

type Env = Record<string, string | undefined>;

const clampInt = (raw: string | undefined, def: number, min: number, max: number) => {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export const isProductionLike = (env: Env): boolean => env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

const isLoopback = (url: string | undefined) => {
  try { const h = new URL(url ?? "").hostname; return h === "127.0.0.1" || h === "localhost" || h === "[::1]"; } catch { return false; }
};

/**
 * The simulated provider may run only outside production. The one exception is the isolated local test stack, which is a production BUILD (so NODE_ENV is
 * production) pointed at a loopback database: it needs the explicit switch AND a loopback database AND no Vercel runtime (Vercel always sets VERCEL).
 */
export function simulatedAllowed(env: Env): boolean {
  if (!isProductionLike(env)) return true;
  return env.JARVIS_ALLOW_SIMULATED_ON_LOCAL_STACK === "1" && isLoopback(env.NEXT_PUBLIC_SUPABASE_URL) && !env.VERCEL;
}

export function readJarvisConfig(env: Env = process.env): JarvisConfig {
  const productionLike = isProductionLike(env);
  const key = env.ANTHROPIC_API_KEY?.trim() || null;
  const wanted = (env.JARVIS_PROVIDER ?? "").trim().toLowerCase();
  let providerKind: JarvisConfig["providerKind"] = "none";
  let providerNote: string | null = null;
  if (wanted === "simulated") {
    if (simulatedAllowed(env)) providerKind = "simulated";
    else providerNote = "The simulated provider is refused in production.";
  } else if (wanted === "" || wanted === "anthropic") {
    if (key) providerKind = "anthropic";
    else providerNote = "No provider key is configured.";
  } else providerNote = "JARVIS_PROVIDER must be anthropic or simulated.";

  const secretRaw = env.JARVIS_CONFIRMATION_SECRET?.trim() ?? "";
  const confirmationSecret = secretRaw.length >= 32 ? secretRaw : productionLike ? null : DEV_SECRET;

  return {
    disabled: env.JARVIS_DISABLED === "1" || env.JARVIS_DISABLED?.toLowerCase() === "true",
    providerKind,
    providerNote,
    apiKey: providerKind === "anthropic" ? key : null,
    model: env.JARVIS_MODEL?.trim() || DEFAULT_JARVIS_MODEL,
    maxInputChars: clampInt(env.JARVIS_MAX_INPUT_CHARS, 6000, 200, 20000),
    maxOutputTokens: clampInt(env.JARVIS_MAX_OUTPUT_TOKENS, 1200, 100, 4000),
    timeoutMs: clampInt(env.JARVIS_TIMEOUT_MS, 20000, 1000, 60000),
    dailyLimit: clampInt(env.JARVIS_DAILY_LIMIT_PER_USER, 30, 1, 500),
    confirmationTtlMs: clampInt(env.JARVIS_CONFIRMATION_TTL_MINUTES, 15, 1, 60) * 60_000,
    proofTtlMs: clampInt(env.JARVIS_PROOF_TTL_SECONDS, 120, 30, 600) * 1000,
    confirmationSecret,
    productionLike,
    paused: (env.JARVIS_PAUSE ?? "").toLowerCase().split(/[\s,]+/).filter((x): x is JarvisConfig["paused"][number] => ["help", "lookups", "chat", "memory", "writes"].includes(x)),
  };
}

/** Is JARVIS usable at all in this environment? Provider-free actions (help) need only "not disabled" and, for confirmations, the secret. */
export function configUnavailableReason(c: JarvisConfig, opts: { needsProvider: boolean; needsSecret: boolean }): string | null {
  if (c.disabled) return "JARVIS is switched off.";
  if (opts.needsProvider && c.providerKind === "none") return c.providerNote ?? "No provider is configured.";
  if (opts.needsSecret && !c.confirmationSecret) return "JARVIS is not configured (no confirmation secret).";
  return null;
}
