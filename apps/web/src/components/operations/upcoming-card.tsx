import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Unknown } from "@/components/operations/parts";
import { PlanningDialog } from "@/components/operations/planning-dialog";
import { KindMark } from "@/components/operations/visuals";
import { datesWord, eventLine, HANDOVER_WORDS, nextResponsible, RISK_WORDS, STAGE_WORDS, TEAM_WORDS, type UpcomingRow } from "@/lib/operations/model";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { cn } from "@/lib/utils";

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}><dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="break-words text-sm">{children}</dd></div>;
}

/**
 * One flagged enquiry in Upcoming Work, made to be scanned: the event and venue as the heading, then the four things Operations plans from (dates, expected
 * decision, provisional Project Manager, the next unresolved item). Everything else Sales and Operations recorded is one tap away under "More". The row is
 * the allowlisted read: there is no price, quote, commercial document or Sales note in it to show.
 */
export function UpcomingCard({ r, people }: { r: UpcomingRow; people: { id: string; name: string }[] }) {
  const dates = datesWord(r);
  const next = nextResponsible(r);
  const ev = eventLine(r);
  const p = r.planning;
  const waitingAnswer = !!p?.question && !p.answer;
  // The one action Operations takes here when the next step is naming a provisional Project Manager: the button says so, instead of a bare "Plan".
  const namePm = next.what === "Name a provisional Project Manager";
  const pending = !!r.handover && r.handover.status !== "draft" && r.handover.status !== "accepted";
  return (
    <li className="os-card p-4" data-testid={`ops-row-${r.reference}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="break-words font-heading text-base font-semibold leading-snug">{ev.event}</h2>
          <p className="text-[13px] text-muted-foreground">{ev.venue ?? "Venue not recorded"} · <span className="font-mono">{r.reference}</span>{ev.event !== r.title ? ` · ${r.title}` : ""}</p>
          {pending ? <p className="mt-1 text-[13px]" data-testid={`ops-handover-line-${r.reference}`}><span className="font-medium">With {next.who}{next.person ? ` (${next.person})` : ""}</span> <span className="text-muted-foreground">·</span> Next: {next.what}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{STAGE_WORDS[r.stage] ?? r.stage}</Badge>
            <Badge variant="outline" className={cn(dates.tentative ? "border-dashed border-[hsl(var(--os-amber)/0.6)] text-[hsl(var(--os-amber))]" : "border-[hsl(var(--os-green)/0.45)] text-[hsl(var(--os-green))]")}>{dates.tentative ? "Tentative dates" : r.won ? "Confirmed (won)" : "Dates confirmed, not won"}</Badge>
            {p?.capacity_conflict ? <Badge variant="outline" className="border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]">Capacity conflict</Badge> : null}
            {p && p.risk !== "unknown" ? <Badge variant="outline">Risk: {RISK_WORDS[p.risk]}</Badge> : null}
          </p>
        </div>
        <span className="flex flex-none items-center gap-2">
          {r.handover?.status === "accepted" && r.handover.project_id ? <Link href={`/projects/${r.handover.project_id}/delivery?from=handover`} className={buttonVariants({ size: "sm" })} data-testid={`ops-setup-${r.reference}`}>Start the project plan</Link> : null}
          {r.handover && r.handover.status !== "draft" ? <Link href={`/projects/handovers?handover=${r.handover.id}`} className={buttonVariants({ variant: r.handover.status === "submitted" ? "default" : "outline", size: "sm" })}>{r.handover.status === "submitted" ? "Assign a Project Manager" : "Open the handover"}</Link> : null}
          <PlanningDialog row={r} people={people} label={namePm ? "Name a provisional Project Manager" : "Plan"} primary={namePm} />
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Fact label={dates.tentative ? "Dates (tentative)" : "Dates"}>
          <ul className="space-y-1">
            <li className="flex flex-wrap items-center gap-x-2"><KindMark kind="installation" />{r.install_start ? dateText(r.install_start) : <Unknown />}</li>
            <li className="flex flex-wrap items-center gap-x-2"><KindMark kind="show" />{r.event_start || r.event_end ? dateRangeText(r.event_start, r.event_end) : <Unknown />}</li>
            <li className="flex flex-wrap items-center gap-x-2"><KindMark kind="dismantling" />{r.dismantle_date ? dateText(r.dismantle_date) : <Unknown />}</li>
          </ul>
        </Fact>
        <Fact label="Expected decision">{r.decision_date ? dateText(r.decision_date) : <Unknown />}</Fact>
        <Fact label={r.handover?.pm ? "Project Manager" : "Provisional Project Manager"}>{r.handover?.pm ?? (p?.provisional_pm ? <>{p.provisional_pm}<span className="block text-[12.5px] text-muted-foreground">Provisional: nothing is booked</span></> : <Unknown>Nobody yet</Unknown>)}</Fact>
        <Fact label="Next unresolved item"><span className="font-medium">{next.what}</span><span className="block text-[12.5px] text-muted-foreground">With {next.who}{next.person ? ` (${next.person})` : ""}</span>{waitingAnswer ? <span className="mt-0.5 block text-[12.5px] text-[hsl(var(--os-amber))]">Your question to Sales is not answered yet</span> : null}</Fact>
      </dl>

      <details className="mt-3 border-t pt-2">
        <summary className="cursor-pointer text-[13px] font-medium text-accent">More details</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Sales owner">{r.owner}</Fact>
          <Fact label="Event edition">{r.edition?.label ?? <Unknown>Not linked to an event</Unknown>}</Fact>
          <Fact label="Expected teams">{r.teams.length > 0 ? r.teams.map((t) => TEAM_WORDS[t] ?? t).join(", ") : <Unknown />}</Fact>
          <Fact label="Expected equipment">{r.equipment.length > 0 ? r.equipment.map((e) => `${e.name ?? "Unnamed"} x ${e.qty ?? "?"}`).join("; ") : <Unknown />}</Fact>
          <Fact label="Sales still to confirm">{r.to_confirm?.trim() || <Unknown>Nothing listed</Unknown>}</Fact>
          <Fact label="Note for Operations">{r.note?.trim() || <Unknown>None</Unknown>}</Fact>
          <Fact label="Handover">{r.handover ? `${HANDOVER_WORDS[r.handover.status] ?? r.handover.status}${r.handover.pm ? ` (${r.handover.pm})` : ""}` : r.won ? "Not prepared yet" : <Unknown>Starts when the enquiry is won</Unknown>}</Fact>
          <Fact label="Operational risk">{p ? `${RISK_WORDS[p.risk]}${p.risk_note ? `: ${p.risk_note}` : ""}` : RISK_WORDS.unknown}</Fact>
          <Fact label="Capacity">{p?.capacity_conflict ? `Conflict${p.capacity_note ? `: ${p.capacity_note}` : ""}` : "No conflict flagged"}</Fact>
          {p?.question ? <Fact label="Question for Sales" className="sm:col-span-2 xl:col-span-3">{p.question}{p.answer ? <span className="mt-1 block"><span className="text-muted-foreground">Sales answered{p.answered_at ? ` ${dateText(p.answered_at.slice(0, 10))}` : ""}:</span> {p.answer}</span> : <span className="mt-1 block text-[hsl(var(--os-amber))]">Not answered yet</span>}</Fact> : null}
        </dl>
      </details>
    </li>
  );
}
