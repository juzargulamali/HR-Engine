import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/projects/parts";
import { formatDateTime } from "@/components/sales/format";
import { listTable } from "@/components/workspace/list-table";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { loadXTrace } from "@/lib/inventory/xshare-data";
import { conditionWord, ownedByText, traceSteps, type XTrace } from "@/lib/inventory/xshare";
import { ConditionBadge, Section } from "../../_panel/parts";

export const metadata = { title: "Transfer" };

/**
 * One transfer between companies, read the same way by BOTH authorised sides: the owner / sender and the receiving company's warehouse operator.
 * Dispatch, in transit, receipt, with the equipment it carried, each unit's owner, ID and serial number. The database function returns only what
 * the viewer may see (never costs, notes or other stock); anyone else gets the same "not found" as for a transfer that does not exist.
 */
export default async function TransferTracePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseRecordId((await params).id);
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const retry = `/inventory/transfers/${(await params).id}`;
  let trace: XTrace | null = null;
  if (id) {
    try { trace = await loadXTrace(id); } catch (e) {
      console.error("[inventory] transfer trace failed", e);
      return <div className="space-y-4"><PageHeader title="Transfer" /><LoadError what="this transfer" retryHref={retry} /></div>;
    }
  }
  if (!trace) {
    return (
      <div className="space-y-4">
        <PageHeader title="Transfer not found" />
        <Alert role="status">No transfer between companies with that address was found, or you do not have access to it. <Link href="/inventory/stock" className="underline underline-offset-2">Back to Stock</Link></Alert>
      </div>
    );
  }
  const t = trace.transfer;
  const steps = traceSteps(trace, (iso) => formatDateTime(iso));
  return (
    <div className="space-y-6">
      <PageHeader title={`Transfer ${t.code}`} description={`${t.fromName} · ${t.senderName} to ${t.toName} · ${t.toCompanyName}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {t.status === "received" ? <Badge variant="success">Received</Badge> : t.status === "in_transit" ? <Badge variant="warning">In transit</Badge> : <Badge variant="outline">Cancelled</Badge>}
        <Link href="/inventory/stock" className="underline underline-offset-2">Back to Stock</Link>
      </div>
      <Alert role="status">Both companies read this same record. The equipment keeps its owner, ID and serial number whichever warehouse it is in; it becomes available at {t.toName} only once it is received there.</Alert>
      <Section title="Dispatch, in transit, receipt">
        <ol className="space-y-2 text-sm">
          {steps.map((s) => (
            <li key={s.key} className="rounded-md border border-border px-3 py-2" aria-current={s.state === "current" ? "step" : undefined}>
              <span className="font-medium">{s.label}</span> {s.state === "waiting" ? <Badge variant="outline">Not yet</Badge> : s.state === "current" ? <Badge variant="warning">Now</Badge> : <Badge variant="success">Done</Badge>}
              <span className="block text-muted-foreground">{s.detail}</span>
            </li>
          ))}
        </ol>
      </Section>
      {trace.units.length > 0 ? (
        <Section title="Equipment">
          <Table className={`min-w-[40rem] ${listTable}`}>
            <caption className="sr-only">Equipment on this transfer</caption>
            <TableHeader><TableRow><TableHead scope="col">Equipment</TableHead><TableHead scope="col">Serial</TableHead><TableHead scope="col">Owner</TableHead><TableHead scope="col">Now</TableHead></TableRow></TableHeader>
            <TableBody>
              {trace.units.map((u) => (
                <TableRow key={u.unitId} className="align-top">
                  <TableCell><span className="font-medium">{u.itemName}</span><span className="block font-mono text-[13px] text-muted-foreground">{u.code}</span></TableCell>
                  <TableCell data-label="Serial">{u.serial ?? "—"}</TableCell>
                  <TableCell data-label="Owner">{ownedByText(u.ownerName)}{u.rented ? " (rented)" : ""}</TableCell>
                  <TableCell data-label="Now">{u.onTheWay ? "On the way" : u.atDestination ? `At ${t.toName}` : "Moved on"}{u.condition ? <> · <ConditionBadge condition={u.condition} /></> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      {trace.quantities.length > 0 ? (
        <Section title="Counted stock">
          <Table className={`min-w-[32rem] ${listTable}`}>
            <caption className="sr-only">Counted stock on this transfer</caption>
            <TableHeader><TableRow><TableHead scope="col">Item</TableHead><TableHead scope="col">Owner</TableHead><TableHead scope="col">Sent</TableHead><TableHead scope="col">Still on the way</TableHead></TableRow></TableHeader>
            <TableBody>
              {trace.quantities.map((q) => (
                <TableRow key={q.itemId}>
                  <TableCell className="font-medium">{q.itemName}</TableCell>
                  <TableCell data-label="Owner">{ownedByText(q.ownerName)}</TableCell>
                  <TableCell data-label="Sent" className="tabular-nums">{q.sent} {q.uom === "each" ? "" : q.uom}</TableCell>
                  <TableCell data-label="Still on the way" className="tabular-nums">{q.onTheWay}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      <Section title="Events">
        <ul className="space-y-2 text-sm">
          {trace.events.map((e) => (
            <li key={e.movementCode} className="rounded-md border border-border px-3 py-2">
              <span className="font-medium">{e.kind === "transfer_dispatch" ? "Dispatched" : "Received"}</span> {formatDateTime(e.at)} · <span className="font-mono">{e.movementCode}</span> · recorded by {e.filedUnderName}{e.by ? `, ${e.by}` : ""}
              <span className="block text-muted-foreground">{e.lines.map((l) => `${l.code ?? `${l.qty} × ${l.itemName}`}${e.kind === "transfer_receive" && l.conditionTo ? ` (${conditionWord(l.conditionTo).toLowerCase()})` : ""}`).join(", ")}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
