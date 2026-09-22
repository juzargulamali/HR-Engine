import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SetPasswordForm } from "./set-password-form";

export default async function SetPasswordPage() {
  // By the time anyone lands here, /auth/confirm has already turned their
  // one-time invite token into a real session (cookies included) — this
  // page's own job is only to collect the password, never to detect a
  // token itself.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="brand-grid relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(700px circle at 50% 0%, hsl(var(--brand-glow) / 0.14), transparent 65%)" }}
        aria-hidden
      />
      <div className="relative w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <Image src="/brand/enginious-icon.png" alt="" width={52} height={52} className="mx-auto" priority />
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              Welcome to <span className="brand-gradient-text">Enginious HR</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Set a password to activate your account.</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            {user ? (
              <SetPasswordForm />
            ) : (
              <Alert variant="destructive">
                This link is invalid or has expired. Ask HR to send you a new invite from Admin → Users.
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
