import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { PasswordResetForm } from "@/components/auth/password-reset-form";

export default function SetPasswordPage() {
  // No session cookie exists yet at this point — the invite link's token
  // arrives as a URL hash fragment, which the server never sees, only the
  // browser. PasswordResetForm itself does the parsing and establishes the
  // session client-side; this page just renders it.
  return (
    <AuthPageShell
      title={
        <>
          Welcome to <span className="brand-gradient-text">Enginious HR</span>
        </>
      }
      subtitle="Set a password to activate your account."
    >
      <PasswordResetForm mode="invite" />
    </AuthPageShell>
  );
}
