import Link from "next/link";
import { canOperateLocation } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/projects/parts";
import { formatDateTime } from "@/components/sales/format";
import { listTable } from "@/components/workspace/list-table";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { loadTransferView } from "@/lib/inventory/transfer-data";
import { nextAction, ownerNote, progressWords, transferProgress, type TransferView } from "@/lib/inventory/transfer-view";
import { SHARING_REVOKED_TEXT, conditionWord } from "@/lib/inventory/xshare";
import { formatQty } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import { ConditionBadge, Section } from "../../_panel/parts";

export const metadata = { title: "Transfer" };

const UNIT_STATE: Record<TransferView["units"][number]["state"], string> = { in_transit: "In transit", received: "Received", moved_on: "Received, since moved on" };

/**
 * ONE transfer, read the same way by everyone who may read it: the sending side and the receiving warehouse. It says who sent it from where, who receives
 * it where, what was sent, what has been received and what is still in transit, who acts next, and every dispatch and receipt recorded against it.
 * Receiving is always done AGAINST this transfer (the button opens the existing Receive transfer form with it chosen); nothing is retyped.
 *
 * A transfer between companies comes from the narrow database function both sides may call; a transfer inside one company comes from the person's own
 * rows. Anyone else gets the same "not found" as for a transfer that does not exist. A failed read says it could not load.
 */
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  const id = parseRecordId(raw);
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  let view: TransferView | null = null;
  if (id) {
    try { view = await loadTransferView(ctx, id); } catch (e) {
      console.error("[inventory] transfer load failed", e);
      return <div className="space-y-4"><PageHeader title="Transfer" /><LoadError what="this transfer" retryHref={`/inventory/transfers/${raw}`} /></div>;
    }
  }
  if (!view) {
    return (
      <div className="space-y-4">
        <PageHeader title="Transfer not found" />
        <Alert role="status">No transfer with that address was found, or you do not have access to it. <Link href="/inventory" className="underline underline-offset-2">Back to Today</Link></Alert>
      </div>
    );
  }
  const t = view;
  const p = transferProgress(t);
  const next = nextAction(t);
  const canReceive = t.status === "in_transit" && p.inTransit > 0 && canOperateLocation(ctx.grants, t.to.companyId, t.to.locationId, ctx.assignedLocationIds);
  const receiveHref = `/inventory/stock?action=transfer&mode=receive&transfer=${t.id}&location=${t.to.locationId}`;
  const facts: [string, React.ReactNode][] = [
    ["Sent from", <span key="f"><span className="font-medium">{t.from.name}</span><span className="block text-muted-foreground">{t.from.companyName}</span></span>],
    ["Going to", <span key="t"><span className="font-medium">{t.to.name}</span><span className="block text-muted-foreground">{t.to.companyName}</span></span>],
    ["Sent", `${formatDateTime(t.dispatchedAt)}${t.dispatchedBy ? ` by ${t.dispatchedBy}` : ""}`],
    ...(t.expectedAt ? [["Expected", formatDateTime(t.expectedAt)] as [string, React.ReactNode]] : []),
    ...(t.carrier || t.reference ? [["Carrier and reference", [t.carrier, t.reference ? `ref ${t.reference}` : null].filter(Boolean).join(" · ")] as [string, React.ReactNode]] : []),
    ...(t.receivedAt ? [["Completed", `${formatDateTime(t.receivedAt)}${t.receivedBy ? ` by ${t.receivedBy}` : ""}`] as [string, React.ReactNode]] : []),
  ];
  return (
    <div className="space-y-6" data-transfer={t.id}>
      <PageHeader title={`Transfer ${t.code}`} description={`${t.from.label} to ${t.to.label}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {t.status === "received" ? <Badge variant="success">Received</Badge> : t.status === "in_transit" ? <Badge variant="warning">{p.received > 0 ? "Partly received" : "In transit"}</Badge> : <Badge variant="outline">Cancelled</Badge>}
        {t.crossCompany ? <Badge variant="outline">Between companies</Badge> : null}
        <Link href="/inventory" className="underline underline-offset-2">Back to Today</Link>
      </div>

      <section aria-label="Where this transfer stands" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <p className="text-base font-semibold tabular-nums" data-testid="transfer-progress">{progressWords(p)}</p>
        <p className="text-sm" data-testid="transfer-next"><span className="font-medium">Who acts next: </span>{next.text}</p>
        {canReceive ? (
          <Link href={receiveHref} className={cn(buttonVariants(), "h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm")}>Receive this transfer</Link>
        ) : t.status === "in_transit" && p.inTransit > 0 ? (
          <p className="text-sm text-muted-foreground">Receiving is done by a warehouse operator at {t.to.label}, or by an Inventory founder of {t.to.companyName}.</p>
        ) : null}
      </section>

      {t.sharingRevoked ? <Alert variant="warning" role="status"><strong>{SHARING_REVOKED_TEXT}</strong>. Equipment already sent can still be received and tracked at {t.to.label}; new transfers under this authorisation are not possible.</Alert> : null}
      {t.crossCompany ? <Alert role="status">Both companies read this same record. The equipment keeps its owner, ID and serial number whichever warehouse it is in; it becomes available at {t.to.label} only once it is received there.</Alert> : null}

      <Section title="The transfer">
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-[13px] font-medium text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>
          ))}
        </dl>
      </Section>

      {t.units.length > 0 ? (
        <Section title="Equipment">
          <Table className={`min-w-[40rem] ${listTable}`}>
            <caption className="sr-only">Equipment on this transfer</caption>
            <TableHeader><TableRow><TableHead scope="col">Equipment</TableHead><TableHead scope="col">Serial</TableHead><TableHead scope="col">Owner</TableHead><TableHead scope="col">Now</TableHead></TableRow></TableHeader>
            <TableBody>
              {t.units.map((u) => (
                <TableRow key={u.unitId} className="align-top" data-state={u.state}>
                  <TableCell><span className="font-medium">{u.itemName}</span><span className="block font-mono text-[13px] text-muted-foreground">{u.code}</span></TableCell>
                  <TableCell data-label="Serial">{u.serial ?? "—"}</TableCell>
                  <TableCell data-label="Owner">{ownerNote(u, t) ?? u.ownerName}{u.rented ? " (rented)" : ""}</TableCell>
                  <TableCell data-label="Now">{UNIT_STATE[u.state]}{u.state === "received" ? ` at ${t.to.name}` : ""}{u.condition ? <> · <ConditionBadge condition={u.condition} /></> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      {t.quantities.length > 0 ? (
        <Section title="Counted stock">
          <Table className={`min-w-[32rem] ${listTable}`}>
            <caption className="sr-only">Counted stock on this transfer</caption>
            <TableHeader><TableRow><TableHead scope="col">Item</TableHead><TableHead scope="col">Owner</TableHead><TableHead scope="col" className="text-right">Sent</TableHead><TableHead scope="col" className="text-right">Received</TableHead><TableHead scope="col" className="text-right">Still in transit</TableHead></TableRow></TableHeader>
            <TableBody>
              {t.quantities.map((q) => (
                <TableRow key={q.itemId}>
                  <TableCell className="font-medium">{q.itemName}</TableCell>
                  <TableCell data-label="Owner">{ownerNote(q, t) ?? q.ownerName}</TableCell>
                  <TableCell data-label="Sent" className="text-right tabular-nums">{formatQty(q.sent, q.uom)}</TableCell>
                  <TableCell data-label="Received" className="text-right tabular-nums">{formatQty(Math.max(0, q.sent - q.inTransit), q.uom)}</TableCell>
                  <TableCell data-label="Still in transit" className="text-right tabular-nums">{formatQty(q.inTransit, q.uom)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      <Section title="What was recorded">
        <ul className="space-y-2 text-sm">
          {t.events.map((e) => (
            <li key={e.movementCode} className="rounded-md border border-border px-3 py-2">
              <span className="font-medium">{e.kind === "transfer_dispatch" ? `Sent from ${t.from.label}` : `Received at ${t.to.label}`}</span> · {formatDateTime(e.at)} · <span className="font-mono">{e.movementCode}</span>
              <span className="block text-muted-foreground">Recorded by {e.by ?? "a colleague"} ({e.filedUnderName})</span>
              <span className="block text-muted-foreground">{e.lines.map((l) => `${l.code ?? `${formatQty(l.qty)} × ${l.itemName}`}${e.kind === "transfer_receive" && l.conditionTo ? ` (${conditionWord(l.conditionTo).toLowerCase()})` : ""}`).join(", ")}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
