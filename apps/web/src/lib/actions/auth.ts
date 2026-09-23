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
    // TEMPORARY — surfacing the real Supabase error (code + message) while
    // diagnosing the Tokyo->Mumbai migration: the generic message above
    // was indistinguishable whether the cause was a wrong password, a
    // misconfigured API key, or anything else. Revert to the generic
    // message once the migration is confirmed working.
    return { error: `That email/password combination wasn't recognized. [debug: ${error.code ?? "no-code"} / ${error.status ?? "no-status"} / ${error.message}]` };
  }

  redirect(parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
