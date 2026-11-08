import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LoadError } from "@/components/workspace/states";
import { getCrmContext } from "@/lib/crm/context";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import { cn } from "@/lib/utils";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import Clients & Agencies" };

export default async function ImportAccountsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const company = selectCompany(ctx.companies, sp.company);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={company ? `/sales/accounts?company=${company.id}` : "/sales/accounts"} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3")}><ArrowLeft className="h-4 w-4" aria-hidden /> Clients &amp; Agencies</Link>
        <h1 className="text-2xl font-semibold">Import from Excel</h1>
        <p className="text-muted-foreground">Upload, check the preview, then confirm. Nothing is saved until you confirm, and importing the same file again changes nothing.</p>
      </div>
      {company ? <ImportFlow companyId={company.id} companyName={company.name} /> : <LoadError what="Import" />}
    </div>
  );
}
