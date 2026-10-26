import Link from "next/link";
import { PageHeader } from "@/components/projects/parts";
import { AccessNotice } from "@/components/os/access-notice";
import { Muted, Panel } from "@/components/projects/parts";
import { InviteUserForm } from "@/components/people-access/invite-user-form";
import { CompanySettingsView } from "@/components/people-access/company-settings";
import { paHref } from "@/components/people-access/links";
import { PersonDetail } from "@/components/people-access/person-detail";
import { PersonList } from "@/components/people-access/person-list";
import { loadPeopleAccess, type PaTab } from "@/lib/people-access/data";

export const metadata = { title: "People & Access" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const TABS: readonly PaTab[] = ["account", "job", "roles", "modules"];

export default async function PeopleAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = { q: one(sp.q), company: one(sp.company), person: one(sp.person) };
  const view = one(sp.view) === "company" ? ("company" as const) : undefined;
  const tabParam = one(sp.tab);
  const tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as PaTab) : null;

  const result = await loadPeopleAccess(params);
  if (result.kind === "signed-out") return null;
  if (result.kind === "denied") {
    return <AccessNotice title="People & Access">You cannot manage people or access. This page is for System Administrators, HR Admins and people who manage access to Sales, Projects, Inventory or project budgets.</AccessNotice>;
  }
  const data = result.data;
  const hasCompanySettings = data.companySettings.projects.length > 0 || data.companySettings.inventory.length > 0;
  const companyNames = new Map(data.companies.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="People & Access"
        description="Accounts, job details, HR roles and module access in one place. You see only the people and the settings you are allowed to manage."
        actions={hasCompanySettings ? (
          <nav aria-label="Sections" className="flex gap-1">
            <Link href={paHref({ ...params })} aria-current={view ? undefined : "page"} className={`rounded-md px-3 py-1.5 text-sm ${view ? "text-muted-foreground hover:text-foreground" : "bg-muted font-semibold"}`}>People</Link>
            <Link href={paHref({ view: "company" })} aria-current={view ? "page" : undefined} className={`rounded-md px-3 py-1.5 text-sm ${view ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}>Company settings</Link>
          </nav>
        ) : undefined}
      />

      {view === "company" ? <CompanySettingsView settings={data.companySettings} /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            {data.isSysAdmin ? (
              <details className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">Invite a person</summary>
                <div className="mt-3"><InviteUserForm /></div>
              </details>
            ) : null}
            <PersonList people={data.people} total={data.totalPeople} companies={data.companies} params={params} companyNames={companyNames} showRoles={data.isSysAdmin} />
          </div>
          <div className="min-w-0">
            {data.selected ? <PersonDetail data={data} tab={tab} params={params} /> : (
              <Panel title="Choose a person">
                <Muted>Pick someone on the left to see and change what you are allowed to manage for them: {[data.isSysAdmin ? "their account and HR roles" : null, data.isSysAdmin || data.isHrAdmin ? "job and department" : null, data.managed.length > 0 ? "module access" : null].filter(Boolean).join(", ")}.</Muted>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
