import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Enginious HR</h1>
          <p className="text-sm text-muted-foreground">Sign in with the account your HR team set up for you.</p>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
