import Image from "next/image";
import { LoginForm } from "./login-form";

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
        style={{ background: "radial-gradient(700px circle at 50% 0%, hsl(var(--brand-glow) / 0.14), transparent 65%)" }}
        aria-hidden
      />
      <div className="relative w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <Image src="/brand/enginious-icon.png" alt="" width={52} height={52} className="mx-auto" priority />
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              Enginious <span className="brand-gradient-text">HR Engine</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in with the account your HR team set up for you.</p>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
