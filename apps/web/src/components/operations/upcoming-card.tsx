import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Unknown } from "@/components/operations/parts";
import { PlanningDialog } from "@/components/operations/planning-dialog";
import { datesWord, HANDOVER_WORDS, nextResponsible, RISK_WORDS, STAGE_WORDS, TEAM_WORDS, type UpcomingRow } from "@/lib/operations/model";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { cn } from "@/lib/utils";

/** One flagged enquiry in Upcoming Work: what Sales recorded for planning (top), what Operations recorded (below), and who has the next step. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[12px] uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="break-words text-sm">{children}</dd></div>;
}

export function UpcomingCard({ r, people }: { r: UpcomingRow; people: { id: string; name: string }[] }) {
  const dates = datesWord(r);
  const next = nextResponsible(r);
  const p = r.planning;
  return (
    <li className="os-card space-y-3 p-4" data-testid={`ops-row-${r.reference}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13px] text-muted-foreground">{r.reference}</span>
        <span className="font-medium">{r.title}</span>
        <Badge variant="outline">{STAGE_WORDS[r.stage] ?? r.stage}</Badge>
        <Badge variant="outline" className={cn(dates.tentative ? "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]" : "border-[hsl(var(--os-green)/0.4)] text-[hsl(var(--os-green))]")}>{dates.text}</Badge>
        {p?.capacity_conflict ? <Badge variant="outline" className="border-destructive text-destructive">Capacity conflict</Badge> : null}
        <span className="ml-auto flex items-center gap-2">
          {r.handover && r.handover.status !== "draft" ? <Link href={`/projects/handovers?handover=${r.handover.id}`} className={buttonVariants({ variant: r.handover.status === "submitted" ? "default" : "outline", size: "sm" })}>{r.handover.status === "submitted" ? "Assign a Project Manager" : "Open the handover"}</Link> : null}
          <PlanningDialog row={r} people={people} />
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Sales owner">{r.owner}</Fact>
        <Fact label="Expected decision">{r.decision_date ? dateText(r.decision_date) : <Unknown />}</Fact>
        <Fact label="Event edition">{r.edition?.label ?? <Unknown>Not linked to an event</Unknown>}</Fact>
        <Fact label="Venue or city">{[r.edition?.venue, r.location].filter(Boolean).join(" · ") || <Unknown />}</Fact>
        <Fact label="Installation">{r.install_start ? dateText(r.install_start) : <Unknown />}</Fact>
        <Fact label="Show">{r.event_start || r.event_end ? dateRangeText(r.event_start, r.event_end) : <Unknown />}</Fact>
        <Fact label="Dismantling">{r.dismantle_date ? dateText(r.dismantle_date) : <Unknown />}</Fact>
        <Fact label="Expected teams">{r.teams.length > 0 ? r.teams.map((t) => TEAM_WORDS[t] ?? t).join(", ") : <Unknown />}</Fact>
        <Fact label="Expected equipment">{r.equipment.length > 0 ? r.equipment.map((e) => `${e.name ?? "Unnamed"} x ${e.qty ?? "?"}`).join("; ") : <Unknown />}</Fact>
        <Fact label="Sales still to confirm">{r.to_confirm?.trim() || <Unknown>Nothing listed</Unknown>}</Fact>
        <Fact label="Note for Operations">{r.note?.trim() || <Unknown>None</Unknown>}</Fact>
        <Fact label="Handover">{r.handover ? `${HANDOVER_WORDS[r.handover.status] ?? r.handover.status}${r.handover.pm ? ` (${r.handover.pm})` : ""}` : r.won ? "Not prepared yet" : <Unknown>Starts when the enquiry is won</Unknown>}</Fact>
      </dl>
      <dl className="grid gap-x-6 gap-y-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={r.handover?.pm ? "Project Manager" : "Provisional Project Manager"}>{r.handover?.pm ?? (p?.provisional_pm ? `${p.provisional_pm} (provisional, nothing is booked)` : <Unknown>Nobody yet</Unknown>)}</Fact>
        <Fact label="Operational risk">{p ? `${RISK_WORDS[p.risk]}${p.risk_note ? `: ${p.risk_note}` : ""}` : RISK_WORDS.unknown}</Fact>
        <Fact label="Capacity">{p?.capacity_conflict ? `Conflict${p.capacity_note ? `: ${p.capacity_note}` : ""}` : "No conflict flagged"}</Fact>
        <Fact label="Next step">{next.who}{next.person ? ` (${next.person})` : ""}: {next.what}</Fact>
        {p?.question ? <div className="sm:col-span-2 lg:col-span-4"><Fact label="Question for Sales">{p.question}{p.answer ? <span className="mt-1 block"><span className="text-muted-foreground">Sales answered{p.answered_at ? ` ${dateText(p.answered_at.slice(0, 10))}` : ""}:</span> {p.answer}</span> : <span className="mt-1 block text-[hsl(var(--os-amber))]">Not answered yet</span>}</Fact></div> : null}
      </dl>
    </li>
  );
}
