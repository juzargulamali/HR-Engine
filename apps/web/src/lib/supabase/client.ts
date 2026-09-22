import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

/**
 * Browser-side client. Uses only the anon key — safe to ship to the client
 * because RLS is what actually gates every read/write (architecture doc
 * §1.6). Never import the service-role client (lib/supabase/admin.ts) here
 * or anywhere reachable from a Client Component.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
