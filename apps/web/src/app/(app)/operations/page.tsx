import { PageHeader } from "@/components/projects/parts";
import { OverviewView } from "@/components/operations/overview-view";
import { CompanyTabs, ReadState } from "@/components/operations/parts";
import { getOperationsContext, loadOverview, loadSiteActivities, loadUpcoming, pickCompany } from "@/lib/operations/data";
import { todayIso } from "@/lib/projects/format";

export const metadata = { title: "Operations" };


/**
 * Operations Overview for one company, which is the one in the address, else the one the person used last (while it is still theirs), else their default. Order: the decisions assigned to them, the follow-ups
 * with their named owners, Next on site, then the summaries (figures, installation readiness, timeline, week chart, equipment, health, Sales, team pressure).
 * Every item comes from a record (handovers, tasks, milestones, the Delivery Plan, equipment requests and reservations) and links to the screen where the person
 * who owns that work acts. Nothing is scored or estimated. A section whose read failed says so; it is never shown as "nothing".
 */
export default async function OperationsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getOperationsContext();
  if (!ctx) return null;
  const company = await pickCompany(ctx, typeof sp.company === "string" ? sp.company : undefined);
  if (!company) return null;
  const self = `/operations?company=${company.id}`;
  // One bounded read of the dated site activities per page: Next on site, the timeline and team pressure all use it.
  const [ov, up, sites] = await Promise.all([loadOverview(company.id), loadUpcoming(company.id), loadSiteActivities(company.id)]);
  const today = todayIso();
  const header = <PageHeader title="Operations" description={company.name} />;
  if (ov.state !== "ok") return <div className="space-y-5">{header}<CompanyTabs companies={ctx.companies} current={company.id} base="/operations" /><ReadState result={ov} what="the Operations Overview" retryHref={self} /></div>;

  return <OverviewView header={header} companies={ctx.companies} company={company} ov={ov} up={up} sites={sites} today={today} viewerId={ctx.projects.userId} />;
}
