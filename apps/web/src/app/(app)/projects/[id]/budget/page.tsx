import { Alert } from "@/components/ui/alert";
import { BudgetWorkspace, type BudgetTab } from "@/components/budget/workspace";
import { LoadError } from "@/components/workspace/states";
import { getCurrentSession } from "@/lib/auth/session";
import { loadOwnClaims } from "@/lib/budget/claims";
import { loadBudgetView } from "@/lib/budget/data";

export const metadata = { title: "Budget & Expenses" };

const SECTIONS = ["budget", "funds", "actuals", "settlement"] as const;

/**
 * Budget & Expenses of one project, as the Project Manager sees it: prepare the budget, enter the actual expenses afterwards, follow Finance's decisions and
 * settlement. Finance works on the very same records in the Finance area (/finance/project-budgets); nothing is entered twice.
 */
export default async function ProjectBudgetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string }> }) {
  const { id } = await params;
  const { section } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;
  const heading = <h2 className="text-lg font-semibold">Budget &amp; Expenses</h2>;
  const loaded = await loadBudgetView(id);
  if (loaded.state === "not_installed") return <div className="space-y-4">{heading}<Alert role="status">Project Budget &amp; Expenses is not installed in this environment yet. Nothing about this project is affected.</Alert></div>;
  if (loaded.state === "denied") return <div className="space-y-4">{heading}<Alert role="status">You do not have access to this project&apos;s budget. The Project Manager and Finance of the owning company can open it.</Alert></div>;
  if (loaded.state === "error") return <div className="space-y-4">{heading}<LoadError what="the budget of this project" retryHref={`/projects/${id}/budget`} /></div>;
  const view = loaded.view;
  const claims = view.viewer.is_pm ? await loadOwnClaims(session.userId) : [];
  const initial = SECTIONS.find((s) => s === section) as BudgetTab | undefined;
  return <div className="space-y-4">{heading}<BudgetWorkspace view={view} claims={claims} initialTab={initial} /></div>;
}
