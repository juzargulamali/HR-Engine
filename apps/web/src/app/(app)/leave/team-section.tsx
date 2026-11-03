import Link from "next/link";
import { LoadError } from "@/components/workspace/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { balancesText, type Cell, type TeamRow } from "@/lib/leave/team";

const CouldNot = () => <span className="text-sm text-destructive">Could not load</span>;
const show = <T,>(c: Cell<T>, f: (v: T) => React.ReactNode) => (c.status === "ok" ? f(c.value) : <CouldNot />);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/**
 * Leave for the people the viewer can read (their reports, or their company for HR, Finance and the executives): balances, Recovery Leave, requests waiting and
 * the next approved leave, waiting requests first. Read through the viewer's own session, so it shows exactly what they could already open person by person;
 * a dash means that figure is not part of their access, and a source that could not be read says so instead of showing zero.
 */
export function TeamLeaveSection({ result, today }: { result: { failed: boolean; rows: TeamRow[]; total: number; capped: boolean }; today: string }) {
  if (result.failed) return <LoadError what="the team's leave" retryHref="/leave" />;
  if (result.rows.length === 0) return null;
  const waiting = result.rows.reduce((n, r) => n + (r.pending.status === "ok" ? r.pending.value : 0), 0);
  const anyUnknown = result.rows.some((r) => r.pending.status === "failed");
  return (
    <Card id="team-leave">
      <CardHeader>
        <CardTitle>Team leave</CardTitle>
        <p className="text-sm text-muted-foreground">
          The people you can see leave for, with requests waiting first. {anyUnknown ? "Requests waiting could not be counted." : `${waiting} ${waiting === 1 ? "request is" : "requests are"} waiting for a decision.`} Decisions are made in Approvals.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Leave balance</TableHead>
              <TableHead>Recovery Leave</TableHead>
              <TableHead>Waiting</TableHead>
              <TableHead>Next leave</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((r) => (
              <ClickableRow key={r.id} href={`/employees/${r.id}?tab=leave`}>
                <TableCell>
                  <Link href={`/employees/${r.id}?tab=leave`} className="font-medium hover:underline">{r.name}</Link>
                  {r.jobTitle ? <span className="block text-sm text-muted-foreground">{r.jobTitle}</span> : null}
                </TableCell>
                <TableCell>{show(r.balances, (b) => balancesText(b.map((x) => ({ ...x, days: x.days }))))}</TableCell>
                <TableCell>{show(r.recovery, (v) => (v === null ? "—" : `${v} days`))}</TableCell>
                <TableCell>{show(r.pending, (n) => (n > 0 ? <span className="font-medium">{n} waiting</span> : "—"))}</TableCell>
                <TableCell>{show(r.nextLeave, (d) => (d === null ? "—" : d === today ? "Away today" : day(d)))}</TableCell>
              </ClickableRow>
            ))}
            {result.rows.length === 0 ? (
              <TableRow><TableCell colSpan={5}><EmptyState dense title="Nobody to show." /></TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">
          {result.capped ? `Showing the first ${result.rows.length} of ${result.total} people. ` : ""}A dash means nothing is recorded, or that figure is not part of your access. Balances are the same numbers as on each person&apos;s Leave tab.
        </p>
      </CardContent>
    </Card>
  );
}
