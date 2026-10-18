import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      title={
        <>
          Forgot your <span className="brand-gradient-text">password</span>?
        </>
      }
      subtitle="Enter your email and we'll send you a link to reset it, if an account exists."
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
