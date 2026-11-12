import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * The client used ONLY to ask Supabase to email someone a set-password or reset-password link.
 *
 * Why it is not the ordinary server client (lib/supabase/server.ts): that client is built by @supabase/ssr, which always uses the
 * "PKCE" sign-in flow. For a recovery email that means two things the pages that receive the link cannot handle:
 *   1. the link comes back as `/set-password?code=...` and not with the session in the address's `#` part, which is the only shape
 *      /set-password and /reset-password read; and
 *   2. the code can only be exchanged by the browser that ASKED for the email, because the secret half is stored in that browser's
 *      cookies. For "Resend invite" and "Send password reset" that browser is the administrator's, never the recipient's.
 * So every such link opened by its recipient read "This link is invalid or has expired", however fresh it was.
 *
 * This client uses the plain flow, keeps no session and writes no cookie. It holds only the public (anon) key: it can ask for an
 * email to be sent and nothing else. Who may ask is decided by the action that calls it, before it is created.
 */
export function createEmailLinkClient() {
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
