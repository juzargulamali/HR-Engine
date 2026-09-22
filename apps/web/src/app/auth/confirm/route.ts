import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the project's email templates must point (Supabase Dashboard ->
 * Authentication -> Emails -> "Invite user", link: /auth/confirm?token_hash=
 * {{ .TokenHash }}&type=invite&next={{ .RedirectTo }}), instead of the
 * default {{ .ConfirmationURL }}. That default hits Supabase's own /verify
 * endpoint and redirects back with a ready-made access_token in the URL
 * hash — a real session, but one @supabase/ssr's browser client (hardcoded
 * to flowType: "pkce") refuses to pick up, throwing "Not a valid PKCE flow
 * url" instead of ever emitting SIGNED_IN. verifyOtp() here does the same
 * verification server-side instead, and writes the resulting session as
 * cookies the way every other Server Action/Component in this app expects.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  const destination = next && next.startsWith(origin) ? next : `${origin}/set-password`;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(destination);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
