import { AccessNotice } from "@/components/os/access-notice";
import { Alert } from "@/components/ui/alert";
import { InboxList } from "@/components/budget/inbox-list";
import { LoadError } from "@/components/workspace/states";
import { loadBudgetInbox } from "@/lib/budget/data";

export const metadata = { title: "Project budgets" };

const FILTERS = ["budget", "actuals", "settlement"] as const;

/** The Finance inbox for project budgets and expenses. It lists records across the companies this person is authorised for; each row opens the one shared project record. */
export default async function ProjectBudgetsInboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const loaded = await loadBudgetInbox();
  if (loaded.state === "not_installed") return <AccessNotice title="Project budgets">Project Budget &amp; Expenses is not installed in this environment yet. Nothing else is affected.</AccessNotice>;
  if (loaded.state === "error") return <div className="space-y-4"><h1 className="text-2xl font-semibold">Project budgets</h1><LoadError what="the Finance inbox" retryHref="/finance/project-budgets" /></div>;
  const { inbox } = loaded;
  if (inbox.companies.length === 0) {
    return <AccessNotice title="Project budgets">You do not have access to project budgets. Finance people are given access, company by company, by the owner of the system; a Project Manager opens the budget from the project itself.</AccessNotice>;
  }
  const initial = FILTERS.find((f) => f === filter);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Project budgets</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Budgets and final expenses waiting for a decision, and projects that still have money to settle. Opening a row shows the same record the Project Manager works on; there is no second form.
        </p>
      </div>
      {!inbox.is_finance_anywhere ? <Alert role="status" className="text-sm">You can read these records but not decide or record anything: that needs Finance access.</Alert> : null}
      <InboxList inbox={inbox} initialFilter={initial} />
    </div>
  );
}
