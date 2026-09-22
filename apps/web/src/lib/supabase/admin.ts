import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * The ONE place in the codebase allowed to use SUPABASE_SERVICE_ROLE_KEY.
 * `import "server-only"` makes any accidental import from a Client
 * Component a build-time error, not just a code-review nit — see
 * docs/01-architecture.md §1.6 and docs/07-risk-register.md risk 2.
 *
 * This client bypasses RLS entirely. Use it only for operations RLS cannot
 * express — provisioning an auth user is the Phase 0 example (see
 * lib/actions/users.ts) — never as a shortcut around a policy that's
 * inconvenient to satisfy from the user's own session.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
