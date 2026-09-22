import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { AppShell } from "@/components/nav/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  // Belt-and-braces: middleware already redirects a signed-out request to
  // /login before it reaches here. This only fires if that ever changes.
  if (!session) redirect("/login");

  return <AppShell session={session}>{children}</AppShell>;
}
