import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/components/sales/format";
import { listTable } from "@/components/workspace/list-table";
import { ConditionBadge, Section } from "@/app/(app)/inventory/_panel/parts";
import { loadXCounted, loadXTransfers, loadXUnits } from "@/lib/inventory/xshare-data";
import { SHARING_REVOKED_TEXT, ownedByText, xCountedText, xUnitStatus, type XCounted, type XTransferHead, type XUnit } from "@/lib/inventory/xshare";
import { formatQty } from "@/lib/inventory/words";

/**
 * Stock page, below the list: other companies' equipment (units and counted stock) that is on its way to, or on the shelf at, a warehouse this person operates
 * (named with its owner and the warehouse it is physically in; no costs; still shown, with "Sharing revoked—contact owner", if the owner later revoked the sharing), and the transfers between companies this person is a party to, each with its trace. Both come from narrow database functions.
 * A failed read says it could not load; a database without the migration shows nothing (nothing can have been sent through it).
 */
export async function CrossCompanySection({ locationId, here }: { locationId: string; here: (patch?: Record<string, string | null>) => string }) {
  let units: XUnit[] = []; let counted: XCounted[] = []; let heads: XTransferHead[] = []; let failed = false;
  try {
    [units, counted, heads] = await Promise.all([loadXUnits({ locationId: locationId || null }), loadXCounted({ locationId: locationId || null }), loadXTransfers()]);
  } catch (e) {
    console.error("[inventory] cross-company section failed", e);
    failed = true;
  }
  if (failed) return <Alert variant="warning" role="status">Equipment of other companies and transfers between companies could not be loaded. Reload to try again.</Alert>;
  const recent = heads.slice(0, 12);
  if (units.length === 0 && counted.length === 0 && recent.length === 0) return null;
  return (
    <div className="space-y-6">
      {units.length > 0 || counted.length > 0 ? (
        <Section title="Equipment of other companies at your warehouses">
          <p className="text-sm text-muted-foreground">You can see what is needed to receive and handle it. It stays owned by its company; costs and its other details stay with the owner.</p>
          <Table className={`min-w-[40rem] ${listTable}`}>
            <caption className="sr-only">Equipment owned by other companies, on its way to or at your warehouses</caption>
            <TableHeader><TableRow><TableHead scope="col">Equipment</TableHead><TableHead scope="col">Serial</TableHead><TableHead scope="col">Condition</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Owner</TableHead></TableRow></TableHeader>
            <TableBody>
              {counted.map((c, i) => (
                <TableRow key={`counted-${i}-${c.itemId}-${c.condition}-${c.binId ?? ""}-${c.transferId ?? ""}-${c.rented ? "r" : "o"}`} className="align-top" aria-label={xCountedText(c)}>
                  <TableCell><span className="font-medium"><span className="tabular-nums">{formatQty(c.qty, c.uom)}</span> {"\u00d7"} {c.itemName}</span>{c.category ? <span className="block text-[13px] text-muted-foreground">{c.category}</span> : null}{c.binCode ? <span className="block text-[13px] text-muted-foreground">Bin {c.binCode}</span> : null}</TableCell>
                  <TableCell data-label="Serial">{"\u2014"}</TableCell>
                  <TableCell data-label="Condition"><ConditionBadge condition={c.condition} />{c.rented ? <Badge variant="outline" className="ml-1">Rented</Badge> : null}</TableCell>
                  <TableCell data-label="Status">{c.custody === "transit" ? `On the way to ${c.locationName}${c.transferCode ? ` (${c.transferCode})` : ""}` : `At ${c.locationName}`}{c.transferId ? <Link href={`/inventory/transfers/${c.transferId}`} className="ml-1 underline underline-offset-2">trace</Link> : null}{c.sharingRevoked ? <span className="block text-[13px] font-medium text-warning">{SHARING_REVOKED_TEXT}</span> : null}</TableCell>
                  <TableCell data-label="Owner">{ownedByText(c.ownerName)}</TableCell>
                </TableRow>
              ))}
              {units.map((u) => (
                <TableRow key={u.unitId} className="align-top">
                  <TableCell><Link href={here({ unit: u.code, open: null, action: null })} scroll={false} className="font-medium underline-offset-2 hover:underline">{u.itemName}</Link><span className="block font-mono text-[13px] text-muted-foreground">{u.code}</span>{u.category ? <span className="block text-[13px] text-muted-foreground">{u.category}</span> : null}</TableCell>
                  <TableCell data-label="Serial">{u.serial ?? "—"}</TableCell>
                  <TableCell data-label="Condition"><ConditionBadge condition={u.condition} />{u.rented ? <Badge variant="outline" className="ml-1">Rented</Badge> : null}</TableCell>
                  <TableCell data-label="Status">{xUnitStatus(u)}{u.transferId ? <Link href={`/inventory/transfers/${u.transferId}`} className="ml-1 underline underline-offset-2">trace</Link> : null}{u.sharingRevoked ? <span className="block text-[13px] font-medium text-warning">{SHARING_REVOKED_TEXT}</span> : null}</TableCell>
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
                  <TableCell data-label="Status">{t.status === "received" ? <Badge variant="success">Received</Badge> : t.status === "in_transit" ? <Badge variant="warning">In transit</Badge> : <Badge variant="outline">Cancelled</Badge>}{t.sharingRevoked && t.status === "in_transit" ? <span className="block text-[13px] font-medium text-warning">{SHARING_REVOKED_TEXT}</span> : null}</TableCell>
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
