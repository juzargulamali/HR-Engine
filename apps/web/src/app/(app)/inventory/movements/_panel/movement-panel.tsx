import Link from "next/link";
import { canConfirmStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CorrectEntry } from "@/components/inventory/stock/movement-correct";
import { listTable } from "@/components/workspace/list-table";
import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { lineFrom, lineTo, movementKindWord, movementWhen, movementZone, type Resolver } from "@/lib/inventory/movement-view";
import { loadMovementDetail, type MovementDetail } from "@/lib/inventory/stock";
import { CONDITION_WORDS, formatQty } from "@/lib/inventory/words";
import type { InvLocationRow } from "@/types/inventory";
import { cn } from "@/lib/utils";

/** One ledger entry beside the list (?open=ID): what it moved, between where, who did it and why, its corrections, and a way to correct it. */
export async function MovementSidePanel({ openId, closeHref, locations }: { openId: string; closeHref: string; locations: readonly InvLocationRow[] }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const id = parseRecordId(openId);
  const shell = (title: string, children: React.ReactNode, subtitle?: string) => <SidePanel title={title} subtitle={subtitle} closeHref={closeHref}>{children}</SidePanel>;
  if (!id) return shell("Entry not found", <Alert role="status">That link does not point to a movement.</Alert>);
  let d: MovementDetail | null;
  try {
    d = await loadMovementDetail(ctx, id);
  } catch (e) {
    console.error("[inventory] movement panel load failed", e);
    return shell("Movement", <LoadError what="this entry" retryHref={`/inventory/movements?open=${id}`} />);
  }
  if (!d) return shell("Entry not found", <Alert role="status">This entry does not exist, or you do not have access to it.</Alert>);

  const m = d.movement;
  const loc = new Map(locations.map((l) => [l.id, l]));
  const zone = movementZone(m, (lid) => loc.get(lid)?.timezone ?? null, locations[0]?.timezone ?? "Asia/Dubai");
  const resolver: Resolver = {
    location: (lid) => (lid ? (loc.get(lid)?.name ?? "Another location") : "—"),
    bin: (bid) => (bid ? (d.binLabels.get(bid) ?? null) : null),
    employee: (eid) => d.names.employee(eid),
    project: (pid) => d.names.project(pid),
  };
  const canCorrect = canConfirmStock(ctx.grants, m.company_id) && d.correctable.size > 0;
  const correctLines = m.lines.filter((l) => d.correctable.has(l.id)).map((l) => ({ id: l.id, label: `${d.items.get(l.item_id) ?? "Item"}${l.to_bin_id ? `, bin ${d.binLabels.get(l.to_bin_id) ?? ""}` : ""}`, recorded: formatQty(l.qty), effective: null }));
  const rows: [string, React.ReactNode][] = [
    ["When", movementWhen(m.occurred_at, zone)],
    ["Recorded by", d.names.user(m.performed_by)],
    ...(m.employee_id ? [["Employee", d.names.employee(m.employee_id)] as [string, React.ReactNode]] : []),
    ...(m.project_id ? [["Project", d.names.project(m.project_id)] as [string, React.ReactNode]] : []),
    ...(m.to_project_id ? [["Moved to project", d.names.project(m.to_project_id)] as [string, React.ReactNode]] : []),
    ...(m.request_id ? [["Request", d.names.request(m.request_id)] as [string, React.ReactNode]] : []),
    ...(m.expected_return_at ? [["Expected back", movementWhen(m.expected_return_at, zone)] as [string, React.ReactNode]] : []),
    ...(m.note ? [["Note", m.note] as [string, React.ReactNode]] : []),
    ...(m.reason ? [["Reason", m.reason] as [string, React.ReactNode]] : []),
    ...(d.corrects ? [["Corrects", <Link key="c" href={`/inventory/movements?open=${d.corrects.id}`} className="font-mono underline underline-offset-2">{d.corrects.code}</Link>] as [string, React.ReactNode]] : []),
    ...(d.correctedBy.length > 0 ? [["Corrected by", <span key="b" className="space-x-2">{d.correctedBy.map((c) => <Link key={c.id} href={`/inventory/movements?open=${c.id}`} className="font-mono underline underline-offset-2">{c.code}</Link>)}</span>] as [string, React.ReactNode]] : []),
  ];

  return shell(
    `${movementKindWord(m.kind)} · ${m.code}`,
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{movementKindWord(m.kind)}</Badge>
        {m.kind === "correction" ? <Badge variant="warning">Correction</Badge> : null}
        {d.correctedBy.length > 0 ? <Badge variant="warning">Corrected</Badge> : null}
        {canCorrect ? <CorrectEntry companyId={m.company_id} movementId={m.id} code={m.code} lines={correctLines} /> : null}
      </div>
      <dl className="divide-y divide-border rounded-md border border-border text-sm">
        {rows.map(([label, value]) => <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]"><dt className="text-[13px] font-medium text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
      </dl>
      <section className="space-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Lines</h3>
        <Table className={cn("min-w-[28rem]", listTable)}>
          <caption className="sr-only">What this entry moved</caption>
          <TableHeader><TableRow><TableHead scope="col">What</TableHead><TableHead scope="col" className="text-right">Quantity</TableHead><TableHead scope="col">From</TableHead><TableHead scope="col">To</TableHead><TableHead scope="col">Condition</TableHead></TableRow></TableHeader>
          <TableBody>
            {m.lines.map((l) => (
              <TableRow key={l.id} className="align-top">
                <TableCell className="break-words font-medium">{d.items.get(l.item_id) ?? "Item"}{l.unit_id && d.unitCodes.get(l.unit_id) ? <span className="block font-mono text-[13px] font-normal text-muted-foreground">{d.unitCodes.get(l.unit_id)}</span> : null}{l.exception_note ? <span className="block text-[13px] font-normal text-muted-foreground">{l.exception_note}</span> : null}</TableCell>
                <TableCell data-label="Quantity" className="whitespace-nowrap text-right tabular-nums">{formatQty(l.qty)}</TableCell>
                <TableCell data-label="From" className="break-words">{lineFrom(l, resolver)}</TableCell>
                <TableCell data-label="To" className="break-words">{lineTo(l, resolver)}</TableCell>
                <TableCell data-label="Condition">{l.condition_from || l.condition_to ? (l.condition_from === l.condition_to || !l.condition_from ? word(l.condition_to) : `${word(l.condition_from)} → ${word(l.condition_to)}`) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <details className="rounded-md border border-border text-sm">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground hover:text-foreground">Transaction details</summary>
        <div className="space-y-1 border-t border-border px-3 py-2 text-muted-foreground">
          <p>Entry ID <span className="break-all font-mono">{m.id}</span></p>
          <p>Recorded at {movementWhen(m.recorded_at, zone)}</p>
          {m.idempotency_key ? <p>Transaction key <span className="break-all font-mono">{m.idempotency_key}</span> (use it in Check a transaction)</p> : null}
        </div>
      </details>
    </div>,
    `${d.names.user(m.performed_by)} · ${movementWhen(m.occurred_at, zone)}`,
  );
}

const word = (c: string | null) => (c ? (CONDITION_WORDS[c as keyof typeof CONDITION_WORDS] ?? c.replace("_", " ")) : "—");
