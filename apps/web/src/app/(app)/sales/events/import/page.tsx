import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getCrmContext } from "@/lib/crm/context";
import { cn } from "@/lib/utils";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import events" };

export default async function ImportEventsPage() {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/sales/events" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3")}><ArrowLeft className="h-4 w-4" aria-hidden /> Events &amp; Exhibitions</Link>
        <h1 className="text-2xl font-semibold">Import events</h1>
        <p className="text-muted-foreground">Add events and their editions to the one shared calendar (UAE, KSA and Poland all see it). Upload, check the preview, then confirm. Nothing is saved until you confirm, and importing the same file again adds nothing.</p>
      </div>
      {ctx.loadFailed ? <Alert variant="destructive">Could not load your Sales access. Reload to try again.</Alert>
        : ctx.grants.length === 0 ? <Alert variant="warning">You do not have Sales access, so you cannot import events.</Alert>
        : <ImportFlow />}
    </div>
  );
}
