import { Lock } from "lucide-react";

/**
 * What a module shows to someone who has no access to it: a quiet card that says what it is and who can grant access. It is a normal
 * page state (not an error), so it uses the same layered surface as the rest of the application.
 */
export function AccessNotice({ title, children }: { title: string; children: React.ReactNode }) {
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
