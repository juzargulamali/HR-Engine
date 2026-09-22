import { isSysAdmin } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/alert";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  // UI-affordance check only — the real gate is the RLS policy on
  // `companies`/`user_roles` (architecture doc §1.5). This just avoids
  // rendering a form someone can't submit anyway.
  if (!session || !isSysAdmin(session.grants)) {
    return (
      <Alert variant="destructive">You need the System Administrator role to view this page.</Alert>
    );
  }

  return <>{children}</>;
}
