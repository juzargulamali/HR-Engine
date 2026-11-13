import Link from "next/link";
import { MapPin } from "lucide-react";
import { MyDayCard, cardLink } from "@/components/my-day/card-shell";
import { assignmentWhen, callWord, venueWord, type SiteAssignment } from "@/lib/projects/site-assignments";
import { CREW_ROLE_LABELS } from "@/lib/projects/phase2/model";

/**
 * "On site next": the person's own site assignments (the scoped read, loaded by the page), shown only when there are some. It works for someone who is not on the project at all.
 * A failed read says so: it is never shown as "nothing assigned".
 */
export function SiteAssignmentsCard({ rows }: { rows: SiteAssignment[] | "error" }) {
  if (rows === "error") return <MyDayCard title="On site next" tone="cool"><p role="status" className="text-sm text-muted-foreground">Your site assignments could not be loaded. <Link href="/site-assignments" className={cardLink}>Try again</Link>.</p></MyDayCard>;
  if (rows.length === 0) return null;
  return (
    <MyDayCard title="On site next" tone="cool" actions={<Link href="/site-assignments" className={cardLink}>All my assignments</Link>}>
      <ul className="space-y-2" data-testid="my-day-site-assignments">
        {rows.slice(0, 3).map((a) => (
          <li key={a.assignment_id} className="text-sm">
            <p className="break-words font-medium"><MapPin className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />{a.title}{a.run_label ? ` · ${a.run_label}` : ""} <span className="font-normal text-muted-foreground">· {CREW_ROLE_LABELS[a.role]}</span></p>
            <p className="break-words text-[13px]">{assignmentWhen(a)} · {venueWord(a)}</p>
            <p className="break-words text-[13px] text-muted-foreground">Call time: {callWord(a)}</p>
          </li>
        ))}
      </ul>
    </MyDayCard>
  );
}
