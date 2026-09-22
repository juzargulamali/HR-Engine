import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

export default function SetPasswordPage() {
  // No session cookie exists yet at this point — the invite link's token
  // arrives as a URL hash fragment, which the server never sees, only the
  // browser. SetPasswordForm itself does the parsing and establishes the
  // session client-side; this page just renders it.
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
            <SetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
