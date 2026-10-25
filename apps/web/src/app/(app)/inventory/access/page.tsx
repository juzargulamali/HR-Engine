import { canManageInvAccess, isInvFounder, type InvCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { CompanyPicker } from "@/components/inventory/setup/company-picker";
import { GiveAccessForm, PeopleList, SharingSection, type AccessLocation, type AccessPersonRow, type SharingRow, type StaffOption } from "@/components/inventory/setup/access-manager";
import { LoadError } from "@/components/workspace/states";
import { getInventoryContext } from "@/lib/inventory/context";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Inventory access" };

export default async function InventoryAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const managed = ctx.companies.filter((c) => canManageInvAccess(ctx.grants, c.id));
  if (managed.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Inventory access" />
        <Alert role="status">Only a founder, or someone a founder gave access management to, can see and change who has Inventory access.</Alert>
      </div>
    );
  }
  const sp = await searchParams;
  const wanted = Array.isArray(sp.company) ? sp.company[0] : sp.company;
  const company = managed.find((c) => c.id === wanted) ?? managed[0]!;
  const viewerIsFounder = isInvFounder(ctx.grants, company.id);

  const supabase = await createClient();
  const [grants, staff, operatorRows, sharing, companies] = await Promise.all([
    supabase.from("inv_company_grants").select("*").eq("company_id", company.id).is("revoked_at", null).order("granted_at"),
    supabase.rpc("inv_staff_directory"),
    supabase.from("inv_operator_locations").select("user_id, location_id").eq("company_id", company.id).is("removed_at", null),
    supabase.from("inv_company_sharing").select("*").or(`company_id.eq.${company.id},use_company_id.eq.${company.id}`).is("revoked_at", null).order("authorised_at"),
    supabase.from("companies").select("id, legal_name").eq("is_active", true).order("legal_name"),
  ]);
  if (grants.error || staff.error || operatorRows.error || sharing.error || companies.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory access" />
        <LoadError what="Inventory access" retryHref="/inventory/access" />
      </div>
    );
  }

  const staffRows = staff.data ?? [];
  const staffBy = new Map(staffRows.map((s) => [s.user_id, { name: s.full_name?.trim() || s.email?.split("@")[0] || "Unnamed user", email: s.email }]));
  const nameOf = (id: string | null) => (id ? (id === ctx.userId ? (ctx.fullName ?? "You") : (staffBy.get(id)?.name ?? "a colleague")) : null);
  const locationsOf = new Map<string, string[]>();
  for (const o of operatorRows.data ?? []) locationsOf.set(o.user_id, [...(locationsOf.get(o.user_id) ?? []), o.location_id]);

  const people: AccessPersonRow[] = (grants.data ?? []).map((g) => ({
    userId: g.user_id,
    name: staffBy.get(g.user_id)?.name ?? (g.user_id === ctx.userId ? (ctx.fullName ?? "You") : "Inactive or former colleague"),
    email: staffBy.get(g.user_id)?.email ?? null,
    capabilities: g.capabilities as InvCapability[],
    grantedAt: g.granted_at,
    grantedByName: nameOf(g.granted_by),
    note: g.note,
    locationIds: locationsOf.get(g.user_id) ?? [],
  }));
  const holders = new Set(people.map((p) => p.userId));
  const available: StaffOption[] = staffRows.filter((s) => !holders.has(s.user_id)).map((s) => ({ id: s.user_id, name: staffBy.get(s.user_id)!.name, email: s.email }));
  const locations: AccessLocation[] = ctx.locations.filter((l) => l.company_id === company.id).map((l) => ({ id: l.id, name: l.name, isActive: l.is_active }));

  const companyNames = new Map((companies.data ?? []).map((c) => [c.id, c.legal_name]));
  const rows = sharing.data ?? [];
  const allows: SharingRow[] = rows.filter((r) => r.company_id === company.id).map((r) => ({ id: r.id, otherCompanyId: r.use_company_id, otherCompanyName: companyNames.get(r.use_company_id) ?? "Another company", note: r.note, since: r.authorised_at }));
  const uses: SharingRow[] = rows.filter((r) => r.use_company_id === company.id).map((r) => ({ id: r.id, otherCompanyId: r.company_id, otherCompanyName: companyNames.get(r.company_id) ?? "Another company", note: r.note, since: r.authorised_at }));
  const others = (companies.data ?? []).filter((c) => c.id !== company.id).map((c) => ({ id: c.id, name: c.legal_name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory access"
        description="Who can use Inventory for each company, and what they may do. This is separate from HR roles, Sales access and Projects access: none of them gives Inventory access, and Inventory access gives none of them."
        actions={<CompanyPicker companies={managed.map((c) => ({ id: c.id, name: c.name }))} value={company.id} />}
      />

      <Panel title="How access works" description="In plain words.">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Access is given to a named person for one company. Nobody gets it automatically, whatever their role.</li>
          <li>With access but no other right, a person sees the catalogue summary only: item names, categories and what is usable.</li>
          <li><strong>Warehouse operators</strong> receive, issue, return, transfer and count stock, but only at the locations they are assigned to, unless they also hold &ldquo;{`All locations`}&rdquo;.</li>
          <li><strong>See stock and movements</strong> is read only. It shows every unit and who holds what.</li>
          <li><strong>Purchase costs are a separate right</strong>, given only by a founder. They are never part of warehouse access, stock viewing, HR, Sales or Projects access.</li>
          <li>Only a founder can make a founder, give access management or give cost visibility. Every change is recorded, and the database checks every action again, so hiding a button is never the only protection.</li>
        </ul>
      </Panel>

      <section className="space-y-4" aria-labelledby="inv-people">
        <h2 id="inv-people" className="text-lg font-semibold break-words">{company.name}</h2>
        <Muted>{viewerIsFounder ? "You are a founder here: you can give and remove any Inventory access, including founder, access-management and cost rights." : "You can manage Inventory access here, but only a founder can give, change or remove founder, access-management and cost rights."}</Muted>
        <Panel title={`People with access (${people.length})`}>
          <PeopleList people={people} companyId={company.id} viewerIsFounder={viewerIsFounder} locations={locations} currentUserId={ctx.userId} />
        </Panel>
        <Panel title="Give access" description="Choose a colleague and what they can do. To change someone who already has access, use Change on their row.">
          {available.length === 0 ? <Muted>Everyone active already has access, or the staff list is not available to you.</Muted> : <GiveAccessForm companyId={company.id} viewerIsFounder={viewerIsFounder} staff={available} locations={locations} />}
        </Panel>
        <Panel title="Sharing equipment with another company" description="Cross-company use is always explicit.">
          <SharingSection companyId={company.id} companyName={company.name} canEdit={viewerIsFounder} allows={allows} uses={uses} others={others} />
        </Panel>
      </section>
    </div>
  );
}
