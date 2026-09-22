import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";

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
