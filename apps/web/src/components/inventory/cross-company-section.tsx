import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/components/sales/format";
import { listTable } from "@/components/workspace/list-table";
import { ConditionBadge, Section } from "@/app/(app)/inventory/_panel/parts";
import { loadXTransfers, loadXUnits } from "@/lib/inventory/xshare-data";
import { ownedByText, xUnitStatus, type XTransferHead, type XUnit } from "@/lib/inventory/xshare";

/**
 * Stock page, below the list: other companies' equipment that is on its way to, or on the shelf at, a warehouse this person operates (named with its
 * owner; no costs), and the transfers between companies this person is a party to, each with its trace. Both come from narrow database functions.
 * A failed read says it could not load; a database without the migration shows nothing (nothing can have been sent through it).
 */
export async function CrossCompanySection({ locationId, here }: { locationId: string; here: (patch?: Record<string, string | null>) => string }) {
  let units: XUnit[] = []; let heads: XTransferHead[] = []; let failed = false;
  try {
    [units, heads] = await Promise.all([loadXUnits({ locationId: locationId || null }), loadXTransfers()]);
  } catch (e) {
    console.error("[inventory] cross-company section failed", e);
    failed = true;
  }
  if (failed) return <Alert variant="warning" role="status">Equipment of other companies and transfers between companies could not be loaded. Reload to try again.</Alert>;
  const recent = heads.slice(0, 12);
  if (units.length === 0 && recent.length === 0) return null;
  return (
    <div className="space-y-6">
      {units.length > 0 ? (
        <Section title="Equipment of other companies at your warehouses">
          <p className="text-sm text-muted-foreground">You can see what is needed to receive and handle it. It stays owned by its company; costs and its other details stay with the owner.</p>
          <Table className={`min-w-[40rem] ${listTable}`}>
            <caption className="sr-only">Equipment owned by other companies, on its way to or at your warehouses</caption>
            <TableHeader><TableRow><TableHead scope="col">Equipment</TableHead><TableHead scope="col">Serial</TableHead><TableHead scope="col">Condition</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Owner</TableHead></TableRow></TableHeader>
            <TableBody>
              {units.map((u) => (
                <TableRow key={u.unitId} className="align-top">
                  <TableCell><Link href={here({ unit: u.code, open: null, action: null })} scroll={false} className="font-medium underline-offset-2 hover:underline">{u.itemName}</Link><span className="block font-mono text-[13px] text-muted-foreground">{u.code}</span>{u.category ? <span className="block text-[13px] text-muted-foreground">{u.category}</span> : null}</TableCell>
                  <TableCell data-label="Serial">{u.serial ?? "—"}</TableCell>
                  <TableCell data-label="Condition"><ConditionBadge condition={u.condition} />{u.rented ? <Badge variant="outline" className="ml-1">Rented</Badge> : null}</TableCell>
                  <TableCell data-label="Status">{xUnitStatus(u)}{u.transferId ? <Link href={`/inventory/transfers/${u.transferId}`} className="ml-1 underline underline-offset-2">trace</Link> : null}</TableCell>
                  <TableCell data-label="Owner">{ownedByText(u.ownerName)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      {recent.length > 0 ? (
        <Section title="Transfers between companies">
          <Table className={`min-w-[40rem] ${listTable}`}>
            <caption className="sr-only">Transfers between companies you are a party to, newest first</caption>
            <TableHeader><TableRow><TableHead scope="col">Transfer</TableHead><TableHead scope="col">From</TableHead><TableHead scope="col">To</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Sent</TableHead></TableRow></TableHeader>
            <TableBody>
              {recent.map((t) => (
                <TableRow key={t.transferId}>
                  <TableCell><Link href={`/inventory/transfers/${t.transferId}`} className="font-medium underline-offset-2 hover:underline">{t.code}</Link></TableCell>
                  <TableCell data-label="From">{t.fromName} · {t.senderName}</TableCell>
                  <TableCell data-label="To">{t.toName} · {t.toCompanyName}</TableCell>
                  <TableCell data-label="Status">{t.status === "received" ? <Badge variant="success">Received</Badge> : t.status === "in_transit" ? <Badge variant="warning">In transit</Badge> : <Badge variant="outline">Cancelled</Badge>}</TableCell>
                  <TableCell data-label="Sent">{formatDateTime(t.dispatchedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
    </div>
  );
}
