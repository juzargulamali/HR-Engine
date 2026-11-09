import Link from "next/link";
import { loadEditionLabel } from "@/lib/crm/events/data";

/**
 * The event edition an enquiry is linked to ("GITEX Global · 2027 · Dubai"), linking to the event page. Nothing is shown for an enquiry with no link (older
 * enquiries have none, and nothing is guessed from their free text). A link that cannot be read says so instead of disappearing.
 */
export async function EventFact({ editionId }: { editionId: string | null | undefined }) {
  if (!editionId) return <span className="text-muted-foreground">Not linked to an event</span>;
  const e = await loadEditionLabel(editionId).catch(() => null);
  if (!e) return <span className="text-muted-foreground">Linked to an event edition that could not be loaded</span>;
  return <span><Link href={`/sales/events/${e.eventId}`} className="underline-offset-2 hover:underline">{e.label}</Link>{e.archived ? <span className="text-muted-foreground"> (archived)</span> : null}</span>;
}
