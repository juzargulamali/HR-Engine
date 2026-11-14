import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { BackLink } from "@/components/workspace/list-memory";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { address, eventsScope, scopeParams } from "../scope";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import events" };

/**
 * Import events: the calendar is shared by every company, so the import itself has no company. The company (or All my companies) the person came from is only
 * carried through, so Back and "View Events & Exhibitions" return to the list counted for the same company.
 */
export default async function ImportEventsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = (await searchParams) ?? {};
  const keep = scopeParams(eventsScope(ctx.companies, sp, await pickSalesCompany(ctx, sp.company)));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink section="events" fallback={address("/sales/events", keep)}>Events &amp; Exhibitions</BackLink>
        <h1 className="text-2xl font-semibold">Import events
          <InfoHint label="Import events" className="ml-1.5">Upload, check the preview, then confirm. Each row is one edition: a row whose event is not in the calendar yet creates the event with that edition; a row whose event exists adds an edition to it; a row already in the calendar with the same dates is skipped. Importing the same file again adds nothing.</InfoHint>
        </h1>
        <p className="text-muted-foreground">Adds events and their editions to the one shared calendar that every company sees. Nothing is saved until you confirm.</p>
      </div>
      {ctx.loadFailed ? <Alert variant="destructive">Could not load your Sales access. Reload to try again.</Alert>
        : ctx.grants.length === 0 ? <Alert variant="warning">You do not have Sales access, so you cannot import events.</Alert>
        : <ImportFlow listHref={address("/sales/events", { ...keep, when: "all" })} />}
    </div>
  );
}
