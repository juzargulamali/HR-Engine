import { hasProjCapability, isProjFounder, PROJ_CAPABILITY_LABELS, type ProjCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { ReferenceCodeForm } from "@/components/projects/reference-code-form";
import { formatDateTime } from "@/components/sales/format";
import { getProjectsContext } from "@/lib/projects/context";
import { createClient } from "@/lib/supabase/server";
import { EditGrantForm, NewGrantForm, RevokeForm } from "./access-forms";

export const metadata = { title: "Projects access" };

export default async function ProjectsAccessPage() {
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const manageable = ctx.companies.filter((c) => hasProjCapability(ctx.grants, c.id, "manage_access"));
  if (manageable.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Projects access" />
        <Alert role="status">Only a founder, or someone a founder gave access management to, can see and change who has Projects access.</Alert>
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: grantRows }, { data: staffRows }] = await Promise.all([
    supabase.from("proj_company_grants").select("*").in("company_id", manageable.map((c) => c.id)).is("revoked_at", null).order("granted_at"),
    supabase.rpc("proj_staff_directory"),
  ]);
  const staff = (staffRows ?? []).map((s) => ({ id: s.user_id, name: s.full_name?.trim() || s.email?.split("@")[0] || "Unnamed", email: s.email }));
  const staffBy = new Map(staff.map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <PageHeader title="Projects access" description="Who can see Projects in each company, and what they may do. This is separate from HR roles and from Sales access: an HR admin, a CEO or a Sales user has no Projects access unless it is given here, and a Projects right gives no HR or Sales right." />
      <Alert role="status">
        Having Projects access only shows the directory of ongoing projects (reference, name, status, Project Manager, high-level dates). A person sees a project&apos;s details, tasks, discussion and files only when the Project Manager adds them to it. Founders see every project of their company.
      </Alert>

      {manageable.map((c) => {
        const founder = isProjFounder(ctx.grants, c.id);
        const rows = (grantRows ?? []).filter((g) => g.company_id === c.id);
        const holders = new Set(rows.map((g) => g.user_id));
        const available = staff.filter((s) => !holders.has(s.id));
        return (
          <section key={c.id} className="space-y-4" aria-labelledby={`co-${c.id}`}>
            <h2 id={`co-${c.id}`} className="text-lg font-semibold">{c.name}</h2>
            {founder || !c.referenceCode ? (
              <Panel title="Project reference code" description={c.referenceCode ? `Projects are numbered ${c.referenceCode}-P-2026-0001 and so on.` : "Not set. No project can be created for this company until a founder sets it."}>
                {founder ? <div className="max-w-sm"><ReferenceCodeForm companyId={c.id} current={c.referenceCode} /></div> : <Muted>A founder sets this.</Muted>}
              </Panel>
            ) : null}
            <Panel title={`People with Projects access (${rows.length})`}>
              {rows.length === 0 ? (
                <Muted>Nobody has access yet.</Muted>
              ) : (
                <ul className="divide-y divide-border">
                  {rows.map((g) => {
                    const caps = g.capabilities as ProjCapability[];
                    const name = staffBy.get(g.user_id)?.name ?? ctx.personName(g.user_id);
                    const lockedForMe = !founder && caps.some((x) => x === "founder" || x === "manage_access");
                    return (
                      <li key={g.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-medium">{name}{g.user_id === ctx.userId ? " (you)" : ""}</p>
                            <p className="text-sm text-muted-foreground">Since {formatDateTime(g.granted_at)}{g.note ? ` · ${g.note}` : ""}</p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {caps.length === 0 ? <Badge variant="outline">Directory only</Badge> : caps.map((x) => <Badge key={x} variant="outline" title={PROJ_CAPABILITY_LABELS[x].description}>{PROJ_CAPABILITY_LABELS[x].label}</Badge>)}
                          </div>
                        </div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm font-medium">Change rights or withdraw access</summary>
                          <div className="mt-3 space-y-5 rounded-md border border-border p-4">
                            <EditGrantForm companyId={c.id} userId={g.user_id} caps={caps} isFounder={founder} lockedForMe={lockedForMe} />
                            {!lockedForMe ? <div className="border-t border-border pt-4"><RevokeForm companyId={c.id} userId={g.user_id} name={name} /></div> : null}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <Panel title="Give access" description="Only active staff can be chosen.">
              {available.length === 0 ? <Muted>Everyone active already has access, or the staff list is not available to you.</Muted> : <NewGrantForm companyId={c.id} staff={available} isFounder={founder} />}
            </Panel>
          </section>
        );
      })}
    </div>
  );
}
