import { canManageCrmAccess, isAnyCrmFounder, isCrmFounder, type CrmCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { getCrmContext } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { AccessManager, type AccessCompany, type AccessGrant, type AccessPerson } from "./access-manager";

export const metadata = { title: "Sales access" };

export default async function SalesAccessPage() {
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const managed = ctx.companies.filter((c) => canManageCrmAccess(ctx.grants, c.id));
  if (managed.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Sales access</h1>
        <Alert>You cannot manage Sales access. Only a founder, or someone a founder has given access management, can grant or revoke it.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: grantRows }, { data: staffRows }] = await Promise.all([
    supabase.from("crm_company_grants").select("*").is("revoked_at", null).in("company_id", managed.map((c) => c.id)).order("granted_at"),
    supabase.rpc("crm_staff_directory"),
  ]);

  // The directory returns active staff only, and returns email addresses only to founders (they need them to tell two
  // people with the same name apart). Everyone else sees names.
  const showEmails = isAnyCrmFounder(ctx.grants);
  const staff: AccessPerson[] = (staffRows ?? []).map((p) => ({
    id: p.user_id,
    name: p.full_name?.trim() || p.email?.split("@")[0] || "Unnamed user",
    email: showEmails ? p.email : null,
  }));
  const staffBy = new Map(staff.map((p) => [p.id, p]));

  const companies: AccessCompany[] = managed.map((c) => ({ id: c.id, name: c.name, isFounder: isCrmFounder(ctx.grants, c.id) }));
  const grants: AccessGrant[] = (grantRows ?? []).map((g) => ({
    userId: g.user_id,
    companyId: g.company_id,
    name: staffBy.get(g.user_id)?.name ?? (g.user_id === ctx.userId ? (ctx.fullName ?? "You") : "Inactive or former colleague"),
    email: staffBy.get(g.user_id)?.email ?? null,
    capabilities: g.capabilities as CrmCapability[],
    grantedAt: g.granted_at,
    grantedByName: g.granted_by ? ctx.personName(g.granted_by) : null,
    note: g.note,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales access</h1>
        <p className="text-muted-foreground">Who can use Sales for each company, and what extra they can do.</p>
      </div>
      <Alert>
        This controls <strong>Sales access only</strong>. It gives no access to HR records (people, leave, payroll, documents), and having an HR role gives no access to Sales. Access is per company. Every change is recorded.
      </Alert>
      <AccessManager companies={companies} staff={staff} grants={grants} currentUserId={ctx.userId} showEmails={showEmails} />
    </div>
  );
}
