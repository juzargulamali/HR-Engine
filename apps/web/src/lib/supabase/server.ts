import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

/** How long a Sales or Projects database function call may take before the page gives up and says so (instead of showing "Saving…" for ever). */
export const RPC_TIMEOUT_MS = 20_000;

/**
 * PostgREST retries a transaction that fails with SQLSTATE 40001 and, when the same check fails every time, never answers. The
 * "changed by someone else" refusals of Sales and Projects use that code, so a stale save could hang. Bound the crm_*, proj_* and pbx_* function
 * calls (and only those: HR functions are untouched) so that case ends in a clear message (friendlyCrmError / friendlyProjectError turn
 * the timeout into words). The message does not claim nothing was saved: a call that was merely slow may still have completed.
 */
const boundedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/\/rest\/v1\/rpc\/(crm|proj|pbx)_/.test(url)) return fetch(input, init);
  const timeout = AbortSignal.timeout(RPC_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

/**
 * Server Component / Server Action / Route Handler client. Still only the
 * anon key — RLS enforces access using the signed-in user's own session,
 * read here from cookies. This is NOT the service-role client; see
 * lib/supabase/admin.ts for the one place that uses that.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: boundedFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — the
            // middleware below refreshes the session on every request, so
            // this is safe to ignore here.
          }
        },
      },
    },
  );
}
