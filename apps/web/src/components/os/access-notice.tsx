import { Lock } from "lucide-react";
import { getCurrentSession } from "@/lib/auth/session";
import { LoadError } from "@/components/workspace/states";

/**
 * What a module shows to someone who has no access to it: a quiet card that says what it is and who can grant access. It is a normal
 * page state (not an error), so it uses the same layered surface as the rest of the application. It is the one place that
 * turns a failed role read into "could not load" instead of "no access".
 */
export async function AccessNotice({ title, children }: { title: string; children: React.ReactNode }) {
  // When the person's roles could not be read, "you do not have access" would be false: say it could not load instead.
  const session = await getCurrentSession();
  if (session?.loadFailed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <LoadError what="your access" note="This is a problem loading your roles, not a missing right." />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div role="status" className="os-card flex items-start gap-3 p-4 text-sm sm:p-5">
        <Lock className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        <p className="max-w-2xl">{children}</p>
      </div>
    </div>
  );
}
