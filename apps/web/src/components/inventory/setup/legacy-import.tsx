"use client";

import { useMemo, useState } from "react";
import { importInventoryLegacyAssets } from "@/lib/actions/inventorySetup";
import type { InvActionState } from "@/lib/inventory/action-utils";
import { legacyRowsIncomplete, legacyRowsToImport, legacySkipWords, type LegacyChoice } from "@/lib/inventory/setup";
import type { InvLegacyAssetRow } from "@/types/inventory";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm } from "@/components/sales/action-form";
import { formatDate } from "@/components/sales/format";

export interface LegacyOption { id: string; label: string }
interface ResultRow { asset_id: string; outcome: "created" | "skipped"; reason: string | null; unit_code: string | null }

const HR_STATUS: Record<string, string> = { in_stock: "In stock", issued: "Issued", under_repair: "Under repair", retired: "Retired" };

/** Founders only: the earlier HR asset register, row by row. The item and the location are chosen for every row; nothing is guessed. */
export function LegacyImport({ companyId, rows, items, locations }: { companyId: string; rows: readonly InvLegacyAssetRow[]; items: readonly LegacyOption[]; locations: readonly LegacyOption[] }) {
  const importable = (r: InvLegacyAssetRow) => !r.already_linked && r.status !== "retired";
  const [choices, setChoices] = useState<Record<string, LegacyChoice>>({});
  const [q, setQ] = useState("");
  const [bulk, setBulk] = useState({ itemId: "", locationId: "" });
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const tagOf = useMemo(() => new Map(rows.map((r) => [r.asset_id, r.asset_tag])), [rows]);
  const choice = (id: string): LegacyChoice => choices[id] ?? { included: false, itemId: "", locationId: "" };
  const set = (id: string, p: Partial<LegacyChoice>) => { setChoices((c) => ({ ...c, [id]: { ...choice(id), ...p } })); };
  const t = q.trim().toLowerCase();
  const shown = rows.filter((r) => t === "" || [r.asset_tag, r.category, r.description ?? "", r.employee_name ?? ""].some((x) => x.toLowerCase().includes(t)));
  const ready = legacyRowsToImport(choices).filter((r) => rows.some((x) => x.asset_id === r.asset_id && importable(x)));
  const incomplete = legacyRowsIncomplete(choices);
  const waiting = rows.filter(importable).length;

  function applyBulk() {
    setChoices((c) => {
      const next = { ...c };
      for (const [id, v] of Object.entries(c)) if (v.included) next[id] = { ...v, itemId: bulk.itemId || v.itemId, locationId: bulk.locationId || v.locationId };
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Alert role="status">
        <p className="font-medium">What importing does</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Each ticked asset becomes an Inventory unit with a new equipment ID, as a <strong>draft</strong>: marked <strong>Not counted yet</strong> and not available until it is counted and the count is confirmed.</li>
          <li>HR&apos;s old register is kept in step: when you issue or return an imported unit in Inventory, the matching HR record changes with it. Nothing in HR is deleted.</li>
          <li>From then on an imported asset can no longer be edited from the old HR Assets page, which says it is managed in Inventory. Assets you do not import keep working exactly as before.</li>
          <li>Importing twice is safe: an asset already imported is skipped.</li>
        </ul>
      </Alert>

      {rows.length === 0 ? <EmptyState dense title="The HR asset register has no assets for this company." /> : (
        <>
          <p className="text-sm text-muted-foreground">{waiting} {waiting === 1 ? "asset is" : "assets are"} waiting to be imported. Tick the ones to import and choose the catalogue item and location of each. If the item is not in the catalogue yet, add it there first.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1 sm:max-w-sm"><label htmlFor="lg-q" className="sr-only">Search the HR register</label><Input id="lg-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tag, description or person" /></div>
            <details className="basis-full rounded-md border border-border">
              <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Fill in the same item or location for all ticked rows</summary>
              <div className="flex flex-wrap items-end gap-3 border-t border-border p-3">
                <div className="min-w-[12rem]"><label htmlFor="lg-bulk-item" className="mb-1 block text-[13px] font-medium text-muted-foreground">Item</label><Select id="lg-bulk-item" value={bulk.itemId} onChange={(e) => setBulk({ ...bulk, itemId: e.target.value })}><option value="">Leave as chosen</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></div>
                <div className="min-w-[10rem]"><label htmlFor="lg-bulk-loc" className="mb-1 block text-[13px] font-medium text-muted-foreground">Location</label><Select id="lg-bulk-loc" value={bulk.locationId} onChange={(e) => setBulk({ ...bulk, locationId: e.target.value })}><option value="">Leave as chosen</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></div>
                <Button type="button" variant="secondary" size="sm" onClick={applyBulk}>Apply to ticked rows</Button>
              </div>
            </details>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Import</TableHead><TableHead>Asset in HR</TableHead><TableHead>Held by</TableHead><TableHead>Catalogue item</TableHead><TableHead>Location</TableHead></TableRow></TableHeader>
            <TableBody>
              {shown.map((r) => {
                const c = choice(r.asset_id);
                const can = importable(r);
                return (
                  <TableRow key={r.asset_id}>
                    <TableCell><input type="checkbox" className="h-4 w-4" aria-label={`Import ${r.asset_tag}`} checked={can && c.included} disabled={!can} onChange={(e) => set(r.asset_id, { included: e.target.checked })} /></TableCell>
                    <TableCell className="min-w-[12rem]"><span className="font-medium">{r.asset_tag}</span> <span className="text-muted-foreground">· {r.category}</span>{r.description ? <span className="block text-sm text-muted-foreground">{r.description}</span> : null}
                      <span className="block text-sm text-muted-foreground">{HR_STATUS[r.status] ?? r.status}{r.value !== null && r.value !== undefined ? ` · value ${r.value}` : ""}{r.purchase_date ? ` · bought ${formatDate(r.purchase_date)}` : ""}</span></TableCell>
                    <TableCell className="min-w-[9rem]">{r.employee_name ? <>{r.employee_name}<span className="block text-sm text-muted-foreground">{r.employee_number}{r.issued_date ? ` · since ${formatDate(r.issued_date)}` : ""}{r.employee_active === false ? " · no longer active" : ""}</span></> : "In the warehouse"}{r.open_assignment_count > 1 ? <span className="block text-sm text-warning">{r.open_assignment_count} open assignments; the latest is used</span> : null}</TableCell>
                    {can ? (
                      <>
                        <TableCell className="min-w-[12rem]"><Select aria-label={`Item for ${r.asset_tag}`} value={c.itemId} onChange={(e) => set(r.asset_id, { itemId: e.target.value })}><option value="">Choose an item…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></TableCell>
                        <TableCell className="min-w-[9rem]"><Select aria-label={`Location for ${r.asset_tag}`} value={c.locationId} onChange={(e) => set(r.asset_id, { locationId: e.target.value })}><option value="">Choose…</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></TableCell>
                      </>
                    ) : <TableCell colSpan={2}>{r.already_linked ? <Badge variant="success">Already imported{r.unit_code ? ` as ${r.unit_code}` : ""}</Badge> : <Badge variant="outline">Retired in HR: not imported</Badge>}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">No asset matches.</p> : null}

          <ActionForm
            action={importInventoryLegacyAssets} submitLabel={ready.length === 0 ? "Import" : `Import ${ready.length} ${ready.length === 1 ? "asset" : "assets"}`} pendingLabel="Importing…"
            onDone={(s) => { const d = (s as InvActionState).detail as { results?: ResultRow[] } | undefined; setResults(d?.results ?? []); setChoices({}); }}
          >
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="rows" value={JSON.stringify(ready)} />
            {incomplete > 0 ? <p className="text-sm text-muted-foreground" role="status">{incomplete} ticked {incomplete === 1 ? "row still needs" : "rows still need"} an item and a location. Those are left out until you choose them.</p> : null}
            {ready.length === 0 && incomplete === 0 ? <p className="text-sm text-muted-foreground">Tick at least one asset, then choose its item and location.</p> : null}
          </ActionForm>
        </>
      )}

      {results ? (
        <section aria-labelledby="lg-results" className="space-y-2">
          <h3 id="lg-results" className="text-sm font-semibold">Result of the import</h3>
          <p className="text-sm text-muted-foreground">{results.filter((r) => r.outcome === "created").length} created, {results.filter((r) => r.outcome === "skipped").length} skipped.</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {results.map((r) => (
              <li key={r.asset_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{tagOf.get(r.asset_id) ?? "Asset"}</span>
                {r.outcome === "created" ? <span><Badge variant="success">Created</Badge> <span className="text-muted-foreground">as {r.unit_code}, Not counted yet</span></span> : <span><Badge variant="warning">Skipped</Badge> <span className="text-muted-foreground">{legacySkipWords(r.reason)}{r.unit_code ? ` (${r.unit_code})` : ""}</span></span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
