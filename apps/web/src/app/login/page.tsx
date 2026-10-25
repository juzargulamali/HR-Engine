import { OsLogo } from "@/components/brand/os-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="brand-grid relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(700px circle at 50% 0%, hsl(var(--brand-glow) / 0.07), transparent 65%)" }}
        aria-hidden
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <OsLogo height={52} endorsement />
          <div>
            <h1 className="sr-only">ENGINIOUS OS</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in with the account your HR team set up for you.</p>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
