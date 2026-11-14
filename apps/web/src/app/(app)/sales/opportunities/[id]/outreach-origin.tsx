import Link from "next/link";
import { loadEnquiryOutreach } from "@/lib/crm/enquiry-outreach";
import { Fact } from "./parts";

/**
 * "Came from outreach": shown only when an outreach this person may see is linked to the enquiry, with the way back to that account (its outreach and history
 * are on the account's page). Nothing is shown when there is none to see; a failed read says it could not load.
 */
export async function OutreachOrigin({ opportunityId, companyId }: { opportunityId: string; companyId: string }) {
  const read = await loadEnquiryOutreach(opportunityId);
  if (read.status === "error") return <Fact label="Came from outreach" className="col-span-2"><span className="text-destructive">Could not load whether this enquiry came from outreach.</span></Fact>;
  if (read.rows.length === 0) return null;
  return (
    <Fact label="Came from outreach" className="col-span-2">
      <ul className="space-y-0.5">
        {read.rows.map((r) => (
          <li key={r.outreachId} className="break-words">
            <Link href={`/sales/accounts/${r.organisationId}?company=${companyId}`} className="underline underline-offset-2">{r.accountName ?? "Open the account"}</Link>
            <span className="text-muted-foreground"> · the account&apos;s outreach history</span>
          </li>
        ))}
      </ul>
      <Link href={`/sales/outreach?company=${companyId}`} className="mt-0.5 inline-block text-muted-foreground underline underline-offset-2">Outreach list</Link>
    </Fact>
  );
}
