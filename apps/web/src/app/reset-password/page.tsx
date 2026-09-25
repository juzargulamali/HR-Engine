import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { PasswordResetForm } from "@/components/auth/password-reset-form";

export default function ResetPasswordPage() {
  // Same shape as /set-password: no session cookie exists yet, the recovery
  // link's token arrives as a URL hash fragment that PasswordResetForm
  // parses client-side.
  return (
    <AuthPageShell
      title={
        <>
          Reset your <span className="brand-gradient-text">password</span>
        </>
      }
      subtitle="Choose a new password to finish resetting your account."
    >
      <PasswordResetForm mode="reset" />
    </AuthPageShell>
  );
}
