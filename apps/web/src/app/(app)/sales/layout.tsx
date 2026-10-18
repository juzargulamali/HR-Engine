import { hasCrmCapability, isAnyCrmFounder } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { SalesTabs, type SalesTab } from "@/components/sales/sales-tabs";
import { getCrmContext } from "@/lib/crm/context";

/**
 * Sales & CRM shell. Access is a company-scoped CRM grant (crm_company_grants), NOT an HR role: an HR admin, CEO or
 * sys_admin without a grant sees this message and no Sales data (RLS returns nothing to them either).
 */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  if (ctx.grants.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sales &amp; CRM</h1>
        <Alert>You do not have Sales access. Sales access is granted per company by the founders.</Alert>
      </div>
    );
  }
  const manageSettings = ctx.grants.some((g) => hasCrmCapability([g], g.companyId, "manage_settings"));
  const manageAccess = ctx.grants.some((g) => hasCrmCapability([g], g.companyId, "manage_access"));
  const tabs: SalesTab[] = [
    { href: "/sales", label: "Overview" },
    { href: "/sales/opportunities", label: "Opportunities" },
    { href: "/sales/pipeline", label: "Pipeline" },
    { href: "/sales/follow-ups", label: "Follow-ups" },
    { href: "/sales/proposals", label: "Proposals" },
    { href: "/sales/clients", label: "Clients" },
    { href: "/sales/reports", label: "Reports" },
    ...(manageSettings || isAnyCrmFounder(ctx.grants) ? [{ href: "/sales/settings", label: "Settings" }] : []),
    ...(manageAccess ? [{ href: "/sales/access", label: "Access" }] : []),
  ];
  return (
    <div className="space-y-6">
      <SalesTabs tabs={tabs} />
      {children}
    </div>
  );
}
