import { Alert } from "@/components/ui/alert";
import { formatDateTime } from "@/components/sales/format";
import { pendingDates, pendingTechnologies, type PendingSalesCheck } from "@/lib/inventory/planning";
import { createClient } from "@/lib/supabase/server";
import { RecordCheckButton } from "./record-check-button";

export interface WaitingLocation { id: string; company_id: string; name: string }

/**
 * The Sales availability checks that are waiting for the warehouse. A warehouse operator has no Sales access, so this is where a
 * request from an enquiry reaches them. Each row has only what is needed to answer it: the enquiry reference, the dates, the
 * technologies with quantities, the place asked for, and who asked and when. Never the title, the client, the value or the notes.
 * Shows nothing when nothing is waiting, or when the person may not answer checks.
 */
export async function SalesChecksWaiting({ locations }: { locations: readonly WaitingLocation[] }) {
  let rows: PendingSalesCheck[] = [];
  let failed = false;
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_pending_sales_checks");
    if (error) {
      // Not installed yet (the function is new) or no access: say nothing rather than alarm anyone.
      failed = !/does not exist|not found|42883|42501|PGRST202/i.test(`${error.code ?? ""} ${error.message}`);
    } else {
      rows = (Array.isArray(data) ? data : []) as PendingSalesCheck[];
    }
  } catch {
    failed = true;
  }
  if (failed) return <Alert role="status">The Sales checks waiting for the warehouse could not be loaded just now. Reload the page to try again.</Alert>;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="sales-checks-waiting" className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 id="sales-checks-waiting" className="text-base font-semibold">Sales checks waiting ({rows.length})</h2>
        <p className="text-sm text-muted-foreground">Sales has asked whether this equipment is available for these dates. Recording the check tells them, with your name and the time. It reserves nothing.</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((c) => (
          <li key={c.check_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="break-words font-medium">{c.reference}</p>
              <p className="break-words text-sm">{pendingTechnologies(c)}</p>
              <p className="text-sm text-muted-foreground">{pendingDates(c)}</p>
              <p className="text-sm text-muted-foreground">{c.location_name ? `Asked for ${c.location_name}` : "No location chosen yet"} · asked by {c.requested_by} on {formatDateTime(c.requested_at)}</p>
            </div>
            <RecordCheckButton
              opportunityId={c.opportunity_id}
              reference={c.reference}
              locations={locations.filter((l) => l.company_id === c.company_id).map((l) => ({ id: l.id, name: l.name }))}
              defaultLocationId={c.location_id}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
