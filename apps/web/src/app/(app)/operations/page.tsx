import { PageHeader } from "@/components/projects/parts";
import { OverviewView } from "@/components/operations/overview-view";
import { CompanyTabs, ReadState } from "@/components/operations/parts";
import { getOperationsContext, loadOverview, loadUpcoming, pickCompany } from "@/lib/operations/data";
import { todayIso } from "@/lib/projects/format";

export const metadata = { title: "Operations" };


/**
 * Operations Overview for one company: what needs a decision first, then what is coming from Sales, then upcoming delivery, then team and warehouse pressure.
 * Every item comes from a record (handovers, tasks, milestones, the Delivery Plan, equipment requests and reservations) and links to the screen where the person
 * who owns that work acts. Nothing is scored or estimated. A section whose read failed says so; it is never shown as "nothing".
 */
export default async function OperationsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getOperationsContext();
  if (!ctx) return null;
  const company = pickCompany(ctx, typeof sp.company === "string" ? sp.company : undefined);
  if (!company) return null;
  const self = `/operations?company=${company.id}`;
  const [ov, up] = await Promise.all([loadOverview(company.id), loadUpcoming(company.id)]);
  const today = todayIso();
  const header = <PageHeader title="Operations" description={`${company.name}: what needs a decision, what goes on site soon and which projects may miss a date.`} />;
  if (ov.state !== "ok") return <div className="space-y-5">{header}<CompanyTabs companies={ctx.companies} current={company.id} base="/operations" /><ReadState result={ov} what="the Operations Overview" retryHref={self} /></div>;

  return <OverviewView header={header} companies={ctx.companies} company={company} ov={ov} up={up} today={today} />;
}
