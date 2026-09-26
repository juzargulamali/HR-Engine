"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export interface SignInState {
  error: string | null;
}

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: "That email/password combination wasn't recognized." };
  }

  redirect(parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/");
}

/**
 * The ordinary sidebar/account-page "Sign out" — the UI next to it (see
 * session-controls.tsx: "Sign out" vs. "Sign out of all devices") promises
 * this ends only the current session. `scope: 'local'` is what actually
 * keeps that promise: Supabase's own default (no scope argument) is
 * 'global', which revokes every session for this user everywhere, not just
 * this browser. See signOutEverywhere() below for the real every-device
 * case.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/**
 * "Sign out of all devices" — scope: 'global' invalidates every session for
 * this user server-side (not just this browser's), the first-class Supabase
 * SDK equivalent of revoking every refresh token at once. Logged before
 * signing out, not after — signOut() ends this session too, so there'd be
 * no auth.uid() left for log_security_event() to resolve if it ran second.
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("log_security_event", { p_action: "all_device_signout_requested" });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
