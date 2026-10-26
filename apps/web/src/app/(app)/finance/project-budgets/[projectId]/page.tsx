import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessNotice } from "@/components/os/access-notice";
import { BudgetWorkspace, type BudgetTab } from "@/components/budget/workspace";
import { LoadError } from "@/components/workspace/states";
import { getCurrentSession } from "@/lib/auth/session";
import { loadOwnClaims } from "@/lib/budget/claims";
import { loadBudgetView } from "@/lib/budget/data";

export const metadata = { title: "Project budget" };

const SECTIONS = ["budget", "funds", "actuals", "settlement"] as const;

/** One project's budget in the Finance area. The same records and the same actions as inside the project; Finance needs no access to the project itself. */
export default async function FinanceProjectBudgetPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ section?: string }> }) {
  const { projectId } = await params;
  const { section } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;
  const back = (
    <Link href="/finance/project-budgets" className="inline-flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <ArrowLeft className="h-4 w-4" aria-hidden />All project budgets
    </Link>
  );
  const loaded = await loadBudgetView(projectId);
  if (loaded.state === "not_installed") return <div className="space-y-4">{back}<AccessNotice title="Project budgets">Project Budget &amp; Expenses is not installed in this environment yet.</AccessNotice></div>;
  if (loaded.state === "denied") return <div className="space-y-4">{back}<AccessNotice title="Project budget">You do not have access to this budget. Finance of the owning company and the project&apos;s Project Manager can open it.</AccessNotice></div>;
  if (loaded.state === "error") return <div className="space-y-4">{back}<LoadError what="this budget" retryHref={`/finance/project-budgets/${projectId}`} /></div>;
  const view = loaded.view;
  const claims = view.viewer.is_pm ? await loadOwnClaims(session.userId) : [];
  const initial = SECTIONS.find((s) => s === section) as BudgetTab | undefined;
  return (
    <div className="space-y-4">
      {back}
      <BudgetWorkspace view={view} claims={claims} initialTab={initial} projectHeader />
    </div>
  );
}
