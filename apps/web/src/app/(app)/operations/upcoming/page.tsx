import { EmptyState } from "@/components/ui/empty-state";
import { Muted } from "@/components/projects/parts";
import { InfoHint } from "@/components/ui/info-hint";
import { CompanyTabs, OpsHeader, ReadState } from "@/components/operations/parts";
import { UpcomingCard } from "@/components/operations/upcoming-card";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { getOperationsContext, loadUpcoming, pickCompany } from "@/lib/operations/data";
import { filterUpcoming } from "@/lib/operations/model";

export const metadata = { title: "Upcoming Work" };

/**
 * Upcoming Work: the enquiries Sales flagged for operational planning, for one company. The row is an allowlisted read: reference, owner, stage, the planning fields,
 * dates, the event edition, expected teams and equipment. Prices, quotes, commercial documents and Sales notes are not in it and cannot be reached from here.
 * Operations records a provisional Project Manager, a risk, a capacity conflict or a question for Sales; the real assignment is made on the handover once the
 * enquiry is won. An enquiry leaves this list when its project exists (it is then in Operations Overview and in Projects) or when Sales removes the flag.
 */
export default async function UpcomingWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const ctx = await getOperationsContext();
  if (!ctx) return null;
  const company = pickCompany(ctx, one("company"));
  if (!company) return null;
  const header = <OpsHeader title="Upcoming Work" help={<p>Enquiries that Sales flagged for operational planning. Tentative work is planned here; nothing is booked until the enquiry is won and its handover is accepted. An enquiry leaves this list when its project exists or when Sales removes the flag.</p>} />;
  const res = await loadUpcoming(company.id);
  const self = `/operations/upcoming?company=${company.id}`;
  if (res.state !== "ok") return <div className="space-y-5">{header}<CompanyTabs companies={ctx.companies} current={company.id} base="/operations/upcoming" /><ReadState result={res} what="Upcoming Work" retryHref={self} /></div>;

  const filters = { q: one("q"), stage: one("stage"), next: one("next") };
  const rows = filterUpcoming(res.data, filters);
  const people = ctx.projects.people.filter((p) => p.companyIds.includes(company.id)).map((p) => ({ id: p.id, name: p.name }));
  return (
    <div className="space-y-5">
      {header}
      <CompanyTabs companies={ctx.companies} current={company.id} base="/operations/upcoming" />
      <div className="os-card p-3 sm:p-4">
        <ListToolbar search={{ value: filters.q, placeholder: "Reference, title, Sales owner, place or event", label: "Search Upcoming Work" }} clearHref={self}
          filters={[
            { name: "stage", label: "Stage", value: filters.stage, options: [{ value: "", label: "Tentative and won" }, { value: "open", label: "Not won yet (tentative)" }, { value: "won", label: "Won (confirmed)" }] },
            { name: "next", label: "Next step with", value: filters.next, options: [{ value: "", label: "Anyone" }, { value: "operations", label: "Operations" }, { value: "sales", label: "Sales" }, { value: "project-manager", label: "Project Manager" }] },
          ]} />
        <Muted className="mt-2">{rows.length} of {res.data.length} flagged {res.data.length === 1 ? "enquiry" : "enquiries"} for {company.name}. <InfoHint label="what is shown here" className="ml-0.5">Prices, quotes and Sales notes are never shown here.</InfoHint></Muted>
      </div>
      {res.data.length === 0 ? (
        <EmptyState title="No enquiry is flagged for Operations" description="Sales flags an enquiry for Operations planning on the enquiry." />
      ) : rows.length === 0 ? (
        <EmptyState dense title="No flagged enquiry matches these filters" />
      ) : (
        <ul className="space-y-3" data-testid="ops-upcoming">{rows.map((r) => <UpcomingCard key={r.id} r={r} people={people} />)}</ul>
      )}
    </div>
  );
}
