import { headers } from "next/headers";
import Link from "next/link";
import { parseInventoryScan } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Muted, PageHeader } from "@/components/projects/parts";
import { LABEL_SIZES, LabelSheet, labelQrSvg, type LabelData, type LabelSize } from "@/components/inventory/label-sheet";
import { PrintButton, type PrintTarget } from "@/components/inventory/setup/print-button";
import { LoadError } from "@/components/workspace/states";
import { getInventoryContext } from "@/lib/inventory/context";
import { labelsHref, MAX_LABELS, parseLabelQuery } from "@/lib/inventory/label-query";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Print labels" };

type SP = Record<string, string | string[] | undefined>;

/** The address the label QR points to: the configured site address, or the address this request came in on. */
async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function InventoryLabelsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const q = parseLabelQuery(await searchParams);
  const supabase = await createClient();

  const unitCodes = q.codes.filter((c) => { const p = parseInventoryScan(c); return p.ok && p.kind === "unit"; });
  const stockCodes = q.codes.filter((c) => !unitCodes.includes(c));
  const wantsSet = q.itemId !== null || q.locationId !== null;
  const cap = MAX_LABELS + 1;

  type UnitRow = { id: string; code: string; company_id: string; item_id: string; location_id: string | null };
  type BalanceRow = { id: string; company_id: string; label_code: string | null; item_id: string; location_id: string | null; bin_id: string | null };
  const unitSelect = "id, code, company_id, item_id, location_id";
  const balanceSelect = "id, company_id, label_code, item_id, location_id, bin_id";

  const queries = await Promise.all([
    unitCodes.length ? supabase.from("inv_units").select(unitSelect).in("code", unitCodes) : null,
    stockCodes.length ? supabase.from("inv_balances").select(balanceSelect).in("label_code", stockCodes) : null,
    q.itemId ? supabase.from("inv_units").select(unitSelect).eq("item_id", q.itemId).neq("lifecycle", "retired").order("code").limit(cap) : null,
    q.itemId ? supabase.from("inv_balances").select(balanceSelect).eq("item_id", q.itemId).not("label_code", "is", null).order("label_code").limit(cap) : null,
    q.locationId ? supabase.from("inv_units").select(unitSelect).eq("location_id", q.locationId).eq("custody_kind", "warehouse").neq("lifecycle", "retired").order("code").limit(cap) : null,
    q.locationId ? supabase.from("inv_balances").select(balanceSelect).eq("location_id", q.locationId).eq("holder_kind", "warehouse").not("label_code", "is", null).order("label_code").limit(cap) : null,
  ]);
  if (queries.some((r) => r?.error)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Print labels" />
        <LoadError what="the labels" retryHref={labelsHref(q, q.size)} />
      </div>
    );
  }
  const unitRows = new Map<string, UnitRow>();
  const balanceRows = new Map<string, BalanceRow>();
  for (const r of [queries[0], queries[2], queries[4]]) for (const u of (r?.data ?? []) as UnitRow[]) unitRows.set(u.code, u);
  for (const r of [queries[1], queries[3], queries[5]]) for (const b of (r?.data ?? []) as BalanceRow[]) if (b.label_code) balanceRows.set(b.label_code, b);

  // Order: the codes as typed first, then whatever an item or location added.
  const ordered = [...q.codes.filter((c) => unitRows.has(c) || balanceRows.has(c)), ...[...unitRows.keys(), ...balanceRows.keys()].filter((c) => !q.codes.includes(c))];
  const truncated = q.truncated || ordered.length > MAX_LABELS;
  const codes = ordered.slice(0, MAX_LABELS);

  const itemIds = [...new Set([...unitRows.values(), ...balanceRows.values()].map((r) => r.item_id))];
  const binIds = [...new Set([...balanceRows.values()].map((b) => b.bin_id).filter((x): x is string => !!x))];
  const [itemsRes, binsRes] = await Promise.all([
    itemIds.length ? supabase.from("inv_items").select("id, name, model").in("id", itemIds) : null,
    binIds.length ? supabase.from("inv_bins").select("id, code").in("id", binIds) : null,
  ]);
  const itemName = new Map((itemsRes?.data ?? []).map((i) => [i.id, [i.name, i.model].filter(Boolean).join(" ")]));
  const binCode = new Map((binsRes?.data ?? []).map((b) => [b.id, b.code]));

  // Labels carry the code, a short item name and a place. No price, no person, no employee, no project.
  const labels: LabelData[] = codes.map((code) => {
    const u = unitRows.get(code);
    if (u) return { code, name: itemName.get(u.item_id) ?? "Equipment", detail: u.location_id ? ctx.locationName(u.location_id) : undefined };
    const b = balanceRows.get(code)!;
    return { code, name: itemName.get(b.item_id) ?? "Stock", detail: b.bin_id ? `Bin ${binCode.get(b.bin_id) ?? ""}`.trim() : "No bin" };
  });
  const origin = await siteOrigin();
  const svgs: Record<string, string> = {};
  await Promise.all(labels.map(async (l) => { svgs[l.code] = await labelQrSvg(origin, l.code); }));

  const targets: PrintTarget[] = codes.map((code) => {
    const u = unitRows.get(code);
    return u ? { companyId: u.company_id, unitId: u.id } : { companyId: balanceRows.get(code)!.company_id, balanceId: balanceRows.get(code)!.id };
  });
  const hidden = q.codes.filter((c) => !unitRows.has(c) && !balanceRows.has(c));
  const asked = q.codes.length > 0 || wantsSet;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader title="Print labels" description="Sticker labels with a QR code, the equipment ID and a short name. The QR carries only the address of the record: no prices, no names of people." />
      </div>

      <div className="space-y-4 print:hidden">
        <form action="/inventory/labels" method="get" className="space-y-3 rounded-md border border-border p-4">
          <div className="space-y-1.5">
            <label htmlFor="lb-codes" className="text-sm font-medium leading-none">Codes to print</label>
            <Input id="lb-codes" name="codes" defaultValue={q.codes.join(", ")} placeholder="UAE-E-00042, UAE-E-00043, UAE-S-00007" autoComplete="off" spellCheck={false} />
            <p className="text-sm text-muted-foreground">Separate codes with commas. You can also open this page from an item or a location to print all of its labels.</p>
          </div>
          {q.itemId ? <input type="hidden" name="item" value={q.itemId} /> : null}
          {q.locationId ? <input type="hidden" name="location" value={q.locationId} /> : null}
          <input type="hidden" name="size" value={q.size} />
          <Button type="submit" variant="secondary">Show labels</Button>
        </form>
        <Muted>A damaged or worn label is printed again from here: a reprint carries the same code and opens the same record, so it never creates new equipment.</Muted>
      </div>

      {q.badId ? <Alert variant="warning" role="status" className="print:hidden">The item or location in the address is not valid, so it was ignored.</Alert> : null}
      {q.invalid.length > 0 ? <Alert variant="warning" role="status" className="print:hidden">Not Inventory codes, so left out: {q.invalid.join(", ")}.</Alert> : null}
      {hidden.length > 0 ? <Alert variant="warning" role="status" className="print:hidden">{hidden.length === 1 ? "1 code" : `${hidden.length} codes`} not shown: {hidden.length === 1 ? "it is" : "they are"} not available to you or {hidden.length === 1 ? "does" : "do"} not exist.</Alert> : null}
      {truncated ? <Alert variant="warning" role="status" className="print:hidden">Only the first {MAX_LABELS} labels are shown. Print them, then ask for the rest.</Alert> : null}

      {labels.length === 0 ? (
        asked ? <Alert role="status" className="print:hidden">No labels to show. Check the codes, or whether you are allowed to see this equipment.</Alert> : <Muted>Type the codes above to see the labels.</Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Size</p>
              <nav aria-label="Label size" className="inline-flex rounded-md border border-border p-0.5">
                {(Object.keys(LABEL_SIZES) as LabelSize[]).map((s) => (
                  <Link key={s} href={labelsHref({ codes: q.codes, itemId: q.itemId, locationId: q.locationId }, s)} aria-current={q.size === s ? "true" : undefined} className={`rounded px-3 py-1 text-sm ${q.size === s ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground"}`}>{LABEL_SIZES[s].label}</Link>
                ))}
              </nav>
              <p className="text-sm text-muted-foreground">{labels.length} {labels.length === 1 ? "label" : "labels"}. Print at 100% scale, without headers or footers.</p>
            </div>
            <PrintButton targets={targets} />
          </div>
          <LabelSheet labels={labels} svgs={svgs} size={q.size} />
        </>
      )}
    </div>
  );
}
