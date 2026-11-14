import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { BackLink } from "@/components/workspace/list-memory";
import { LoadError } from "@/components/workspace/states";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import Clients & Agencies" };

export default async function ImportAccountsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  // An import writes owners, lead sources and exhibitions for ONE company, so the company is never guessed: the one in the address, else the one used
  // last in Sales, else the person's own. With none of those the page asks, and no file can be uploaded until a company is chosen.
  const active = await pickSalesCompany(ctx, sp.company);
  const company = active.company;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BackLink section="accounts" fallback={company ? `/sales/accounts?company=${company.id}` : "/sales/accounts"}>Clients &amp; Agencies</BackLink>
        <h1 className="text-2xl font-semibold">Import from Excel</h1>
        <p className="text-sm text-muted-foreground">Upload, check the preview, then confirm. Nothing is saved until you confirm, and importing the same file again changes nothing.</p>
      </div>
      <CompanySwitch companies={ctx.companies} current={company?.id ?? null} from={active.from} hrefFor={(id) => `/sales/accounts/import?company=${id}`} />
      {/* Keyed by company: choosing another company starts the import again, so a preview made for one company can never be confirmed into another. */}
      {company ? <ImportFlow key={company.id} companyId={company.id} companyName={company.name} /> : active.from === "choose" ? <ChooseCompanyNotice what="the import for that company" /> : <LoadError what="Import" />}
    </div>
  );
}
