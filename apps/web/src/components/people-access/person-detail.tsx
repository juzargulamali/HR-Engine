import Link from "next/link";
import { ROLE_LABELS } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Muted, Panel } from "@/components/projects/parts";
import type { PaTab, PeopleAccessData } from "@/lib/people-access/data";
import { AccountStatusBadge, AccountStatusControls } from "./account-status-controls";
import { AssignRoleForm } from "./assign-role-form";
import { DeleteUserButton } from "./delete-user-button";
import { JobPanel } from "./job-panel";
import { ModuleAccessCard } from "./module-access-card";
import { paHref, type PaParams } from "./links";
import { ResendInviteButton } from "./resend-invite-button";
import { RevokeRoleButton } from "./revoke-role-button";

const TAB_LABEL: Record<PaTab, string> = { account: "Account", job: "Job & department", roles: "HR roles", modules: "Module access" };

/** The right column for one person. Each tab appears only for what this viewer is entitled to; nothing is rendered and then hidden. */
export function PersonDetail({ data, tab, params }: { data: PeopleAccessData; tab: PaTab | null; params: PaParams }) {
  const p = data.selected;
  if (!p) return null;
  const active = tab && data.tabs.includes(tab) ? tab : (data.tabs[0] ?? null);
  const companyName = new Map(data.companies.map((c) => [c.id, c.name]));
  const isSelf = p.userId === data.userId;

  return (
    <section aria-label={`${p.name}`} className="min-w-0 space-y-4">
      <header className="space-y-1">
        <h2 className="break-words text-xl font-semibold">{p.name}{isSelf ? <span className="ml-2 text-sm font-normal text-muted-foreground">(you)</span> : null}</h2>
        {p.email ? <p className="break-all text-sm text-muted-foreground">{p.email}</p> : null}
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {[p.jobTitle, p.employeeCompanyId ? companyName.get(p.employeeCompanyId) : null].filter(Boolean).join(" · ")}
          {p.accountStatus ? <AccountStatusBadge status={p.accountStatus} /> : null}
          {p.userId === null ? <Badge variant="outline">No login yet</Badge> : null}
        </div>
      </header>

      {data.tabs.length === 0 ? <Muted>There is nothing about this person that you manage here.</Muted> : (
        <>
          <nav aria-label="About this person" className="flex flex-wrap gap-1 border-b border-border">
            {data.tabs.map((t) => (
              <Link key={t} href={paHref({ ...params, tab: t })} aria-current={t === active ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${t === active ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {TAB_LABEL[t]}
              </Link>
            ))}
          </nav>

          {active === "account" && p.userId ? (
            <div role="region" aria-label="Account">
            <Panel title="Account" description="The login. Deactivating suspends sign-in without deleting anything.">
              <div className="flex flex-wrap items-start gap-3">
                {p.accountStatus ? <AccountStatusBadge status={p.accountStatus} /> : null}
                {p.accountStatus ? <AccountStatusControls userId={p.userId} status={p.accountStatus} isSelf={isSelf} /> : null}
                {p.accountStatus === "invited" && p.email ? <ResendInviteButton email={p.email} /> : null}
                {!isSelf && p.email ? <DeleteUserButton userId={p.userId} email={p.email} /> : null}
              </div>
            </Panel>
            </div>
          ) : null}

          {active === "job" && data.employee && data.jobView ? (
            <Panel title="Job & department" description="From the employee record. There is no second copy of it here.">
              <JobPanel
                employeeId={data.employee.id} personName={p.name} companyName={data.jobView.companyName} jobTitle={data.employee.jobTitle}
                departmentId={data.employee.departmentId} departmentName={data.jobView.departmentName} managerId={data.employee.managerId} managerName={data.jobView.managerName}
                canEdit={data.canEditJob} departments={data.jobView.departments} managers={data.jobView.managers}
              />
            </Panel>
          ) : null}

          {active === "roles" && p.userId ? (
            <Panel title="HR roles" description="Roles for HR, payroll, leave and approvals. Only a System Administrator can give or take them away.">
              <Alert role="status" className="mb-4">HR roles give <strong>no</strong> access to Sales, Projects, Inventory or project budgets, and module access gives no HR role. Those are set under Module access.</Alert>
              <div className="flex flex-wrap gap-1.5">
                {p.roles.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1">
                    <Badge variant="secondary">{ROLE_LABELS[r.role]}{r.companyId ? ` · ${companyName.get(r.companyId) ?? ""}` : ""}</Badge>
                    <RevokeRoleButton roleGrantId={r.id} />
                  </span>
                ))}
                {p.roles.length === 0 ? <span className="text-sm text-muted-foreground">No HR role yet.</span> : null}
              </div>
              <div className="mt-4 max-w-md border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">Give a role</p>
                <AssignRoleForm users={[{ id: p.userId, email: p.email ?? "", full_name: p.name }]} companies={data.companies.map((c) => ({ id: c.id, legal_name: c.name }))} defaultUserId={p.userId} />
              </div>
            </Panel>
          ) : null}

          {active === "modules" && p.userId ? (
            <div className="space-y-4">
              <Alert role="status">Module access is separate from HR roles and job titles. Nobody gets it automatically: it is given to a named person, for one company, by someone allowed to give it. Every change is recorded.</Alert>
              {[...new Set(data.moduleContexts.map((m) => m.company.id))].map((companyId) => {
                const here = data.moduleContexts.filter((m) => m.company.id === companyId);
                return (
                  <Panel key={companyId} title={here[0]!.company.name}>
                    <div className="space-y-4">
                      {here.map((m) => {
                        const g = p.grants.find((x) => x.module === m.module && x.companyId === m.company.id) ?? null;
                        const assigned = data.operatorLocations[m.company.id] ?? [];
                        return (
                          <ModuleAccessCard
                            key={`${m.module}-${m.company.id}-${p.userId}-${g ? g.capabilities.join(",") || "-" : "none"}-${assigned.join(",")}`}
                            module={m.module} company={m.company} viewerCapabilities={m.viewerCapabilities} person={{ userId: p.userId as string, name: p.name, isSelf }}
                            grant={g ? { capabilities: g.capabilities, grantedAt: g.grantedAt, grantedByName: g.grantedByName, note: g.note } : null}
                            accessManagerCount={m.holders.filter((h) => h.capabilities.includes("manage_access")).length}
                            founderCount={m.holders.filter((h) => h.capabilities.includes("founder")).length}
                            locations={m.locations} assignedLocationIds={assigned}
                          />
                        );
                      })}
                    </div>
                  </Panel>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
