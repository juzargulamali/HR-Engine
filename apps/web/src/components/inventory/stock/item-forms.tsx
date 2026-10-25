"use client";

import { useState } from "react";
import { saveItem, registerUnit, replaceItem, ensureBinLabel, setKitLine } from "@/lib/actions/inventoryStock";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MoreDetails } from "@/components/workspace/quick-add";
import { newMovementKey } from "@/lib/inventory/idempotency";
import { CONDITION_WORDS, TRACKING_WORDS } from "@/lib/inventory/words";
import type { InvTracking } from "@/types/inventory";

export interface CategoryOption { id: string; label: string }
export interface CompanyChoice { id: string; name: string; categories: CategoryOption[] }

const TRACKING_ORDER: InvTracking[] = ["individual", "quantity", "kit", "consumable"];

/** "How is it tracked?" with the plain help text for each answer. */
function TrackingChoice({ value, onChange, idPrefix }: { value: InvTracking | ""; onChange: (t: InvTracking) => void; idPrefix: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">How is it tracked?</legend>
      <div className="space-y-2">
        {TRACKING_ORDER.map((t) => (
          <label key={t} htmlFor={`${idPrefix}-${t}`} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${value === t ? "border-accent/70 bg-secondary/50" : "border-border"}`}>
            <input id={`${idPrefix}-${t}`} type="radio" name="tracking" value={t} checked={value === t} onChange={() => onChange(t)} required className="mt-1" />
            <span><span className="block font-medium">{TRACKING_WORDS[t].label}</span><span className="block text-muted-foreground">{TRACKING_WORDS[t].help}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CountedFields({ idPrefix, uom = "each", scale = 0, locked }: { idPrefix: string; uom?: string; scale?: number; locked?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Unit of measure" htmlFor={`${idPrefix}-uom`} hint="What one is called: each, metre, box, roll.">
        <Input id={`${idPrefix}-uom`} name="unitOfMeasure" defaultValue={uom} maxLength={20} disabled={locked} />
      </Field>
      <Field label="Decimals" htmlFor={`${idPrefix}-scale`} hint="Use decimals only for things measured, such as metres.">
        <Select id={`${idPrefix}-scale`} name="quantityScale" defaultValue={String(scale)} disabled={locked}>
          <option value="0">Whole numbers only</option>
          <option value="1">1 decimal place</option>
          <option value="2">2 decimal places</option>
          <option value="3">3 decimal places</option>
        </Select>
      </Field>
    </div>
  );
}

function DetailFields({ idPrefix, v }: { idPrefix: string; v?: { manufacturer?: string | null; model?: string | null; specification?: string | null; notes?: string | null } }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Manufacturer" htmlFor={`${idPrefix}-mf`}><Input id={`${idPrefix}-mf`} name="manufacturer" defaultValue={v?.manufacturer ?? ""} maxLength={160} /></Field>
        <Field label="Model" htmlFor={`${idPrefix}-md`}><Input id={`${idPrefix}-md`} name="model" defaultValue={v?.model ?? ""} maxLength={160} /></Field>
      </div>
      <Field label="Specification" htmlFor={`${idPrefix}-sp`} hint="The detail that tells look-alikes apart, for example 5 m, 16 A or XLR to jack. The same name, model and specification is the same item.">
        <Input id={`${idPrefix}-sp`} name="specification" defaultValue={v?.specification ?? ""} maxLength={160} />
      </Field>
      <Field label="Notes" htmlFor={`${idPrefix}-nt`}><Textarea id={`${idPrefix}-nt`} name="notes" rows={2} defaultValue={v?.notes ?? ""} /></Field>
    </>
  );
}

/** The short Quick Add form: name, category, how it is tracked (and unit and decimals only for counted stock). The rest is under "Add more details". */
export function QuickAddItemForm({ companies, close }: { companies: CompanyChoice[]; close: () => void }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [tracking, setTracking] = useState<InvTracking | "">("");
  const company = companies.find((c) => c.id === companyId);
  const counted = tracking === "quantity" || tracking === "consumable";
  return (
    <ActionForm action={saveItem} submitLabel="Add item" pendingLabel="Adding…" onDone={close}>
      <input type="hidden" name="after" value="panel" />
      <input type="hidden" name="status" value="active" />
      {companies.length > 1 ? (
        <Field label="Company" htmlFor="qi-company">
          <Select id="qi-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      ) : <input type="hidden" name="companyId" value={companyId} />}
      <Field label="Item name" htmlFor="qi-name">
        <Input id="qi-name" name="name" required maxLength={160} autoFocus placeholder="e.g. Laptop, XLR cable, Gaffer tape" />
      </Field>
      <Field label="Category" htmlFor="qi-cat">
        <Select id="qi-cat" name="categoryId" key={companyId} defaultValue="">
          <option value="">No category yet</option>
          {(company?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      <TrackingChoice value={tracking} onChange={setTracking} idPrefix="qi-tr" />
      {counted ? <CountedFields idPrefix="qi" /> : null}
      <MoreDetails><DetailFields idPrefix="qi" /></MoreDetails>
    </ActionForm>
  );
}

/** Edit the catalogue details. The version is sent so that someone else's change is never silently overwritten. */
export function EditItemForm({ item, categories, canRetire }: {
  item: { id: string; companyId: string; name: string; categoryId: string | null; tracking: InvTracking; uom: string; scale: number; manufacturer: string | null; model: string | null; specification: string | null; notes: string | null; status: "draft" | "active" | "retired"; version: number; locked: boolean };
  categories: CategoryOption[]; canRetire: boolean;
}) {
  const counted = item.tracking === "quantity" || item.tracking === "consumable";
  return (
    <ActionForm action={saveItem} submitLabel="Save changes">
      <input type="hidden" name="companyId" value={item.companyId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="expectedVersion" value={item.version} />
      <Field label="Item name" htmlFor="ei-name"><Input id="ei-name" name="name" required maxLength={160} defaultValue={item.name} /></Field>
      <Field label="Category" htmlFor="ei-cat">
        <Select id="ei-cat" name="categoryId" defaultValue={item.categoryId ?? ""}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      <p className="text-sm text-muted-foreground">Tracked as: <strong>{TRACKING_WORDS[item.tracking].label}</strong>. {item.locked ? "This cannot change once an item has stock or history. Use Replace item to change what it is." : ""}</p>
      {counted ? <CountedFields idPrefix="ei" uom={item.uom} scale={item.scale} locked={item.locked} /> : null}
      <DetailFields idPrefix="ei" v={item} />
      <Field label="Status" htmlFor="ei-status" hint="An item has to be in use before stock can be received for it. Retire an item only when it has no stock left.">
        <Select id="ei-status" name="status" defaultValue={item.status}>
          <option value="draft">Draft (not in use yet)</option>
          <option value="active">In use</option>
          {canRetire ? <option value="retired">Retired</option> : null}
        </Select>
      </Field>
    </ActionForm>
  );
}

/** Retire an item and make its replacement. The reason is kept with both. */
export function ReplaceItemForm({ item, categories }: { item: { id: string; name: string; categoryId: string | null; manufacturer: string | null; model: string | null; specification: string | null; uom: string; counted: boolean }; categories: CategoryOption[] }) {
  return (
    <ActionForm action={replaceItem} submitLabel="Replace item" pendingLabel="Replacing…" variant="destructive">
      <input type="hidden" name="itemId" value={item.id} />
      <p className="text-sm text-muted-foreground">This retires <strong>{item.name}</strong> and creates a new item in its place. Stock already recorded stays with the old item and its history; nothing is moved or deleted. Receive new stock against the new item.</p>
      <Field label="Why is it being replaced?" htmlFor="ri-why"><Textarea id="ri-why" name="reason" rows={2} required placeholder="e.g. The supplier changed the model" /></Field>
      <Field label="New item name" htmlFor="ri-name"><Input id="ri-name" name="name" defaultValue={item.name} maxLength={160} /></Field>
      <Field label="Category" htmlFor="ri-cat">
        <Select id="ri-cat" name="categoryId" defaultValue={item.categoryId ?? ""}>
          <option value="">Keep the same</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      <DetailFields idPrefix="ri" v={{ manufacturer: item.manufacturer, model: item.model, specification: item.specification }} />
      {item.counted ? <Field label="Unit of measure" htmlFor="ri-uom"><Input id="ri-uom" name="unitOfMeasure" defaultValue={item.uom} maxLength={20} /></Field> : null}
    </ActionForm>
  );
}

/** Register one more individual unit. It starts as "Not counted yet" until opening stock is confirmed. */
export function AddUnitForm({ item, locations, canSeeCosts, defaultLocationId }: {
  item: { id: string; companyId: string; name: string };
  locations: { id: string; name: string; bins: { id: string; code: string; label: string | null }[] }[];
  canSeeCosts: boolean; defaultLocationId?: string;
}) {
  const [key, setKey] = useState(() => newMovementKey("unit"));
  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const bins = locations.find((l) => l.id === locationId)?.bins ?? [];
  return (
    <ActionForm action={registerUnit} submitLabel="Register unit" pendingLabel="Registering…" resetOnSuccess onDone={() => setKey(newMovementKey("unit"))}>
      <input type="hidden" name="companyId" value={item.companyId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="key" value={key} />
      <p className="text-sm text-muted-foreground">A new unit of <strong>{item.name}</strong> gets its own ID and QR label. It shows as “Not counted yet” until the opening stock is confirmed.</p>
      <Field label="Serial number (optional)" htmlFor="au-serial"><Input id="au-serial" name="serial" maxLength={120} autoComplete="off" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where is it kept?" htmlFor="au-loc">
          <Select id="au-loc" name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Bin (optional)" htmlFor="au-bin">
          <Select id="au-bin" name="binId" key={locationId} defaultValue="">
            <option value="">No bin</option>
            {bins.map((b) => <option key={b.id} value={b.id}>{b.label?.trim() ? `${b.code} (${b.label})` : b.code}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Condition" htmlFor="au-cond">
        <Select id="au-cond" name="condition" defaultValue="good">
          {Object.entries(CONDITION_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </Select>
      </Field>
      {canSeeCosts ? (
        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Purchase cost (optional)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Cost" htmlFor="au-cost"><Input id="au-cost" name="cost" inputMode="decimal" /></Field>
            <Field label="Currency" htmlFor="au-cur"><Input id="au-cur" name="currency" maxLength={3} defaultValue="AED" className="uppercase" /></Field>
            <Field label="Purchase date" htmlFor="au-pd"><Input id="au-pd" name="purchaseDate" type="date" /></Field>
          </div>
        </fieldset>
      ) : null}
      <Field label="Notes (optional)" htmlFor="au-notes"><Textarea id="au-notes" name="notes" rows={2} /></Field>
    </ActionForm>
  );
}

/** Gives "this item in this bin" its permanent label code (counted stock). Asking again returns the same code. */
export function BinLabelForm({ item, locations }: { item: { id: string; companyId: string }; locations: { id: string; name: string; bins: { id: string; code: string; label: string | null }[] }[] }) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const bins = locations.find((l) => l.id === locationId)?.bins ?? [];
  return (
    <ActionForm action={ensureBinLabel} submitLabel="Create the bin label" pendingLabel="Creating…">
      <input type="hidden" name="companyId" value={item.companyId} />
      <input type="hidden" name="itemId" value={item.id} />
      <p className="text-sm text-muted-foreground">A bin label names this item in one bin. Scanning it opens the item; it never means “everything in the bin”.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location" htmlFor="bl-loc"><Select id="bl-loc" name="locationId" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Bin" htmlFor="bl-bin"><Select id="bl-bin" name="binId" key={locationId} defaultValue=""><option value="">No bin</option>{bins.map((b) => <option key={b.id} value={b.id}>{b.label?.trim() ? `${b.code} (${b.label})` : b.code}</option>)}</Select></Field>
      </div>
    </ActionForm>
  );
}

/** One line of a kit's checklist: what is expected, whether it is required, or remove it. No stock moves. */
export function KitLineForm({ kit, items, current }: { kit: { id: string; companyId: string }; items: { id: string; name: string }[]; current?: { itemId: string; itemName: string; expectedQty: number; required: boolean; note: string | null } }) {
  return (
    <ActionForm action={setKitLine} submitLabel="Save checklist line" pendingLabel="Saving…" resetOnSuccess={!current}>
      <input type="hidden" name="companyId" value={kit.companyId} />
      <input type="hidden" name="kitUnitId" value={kit.id} />
      {current ? (
        <>
          <input type="hidden" name="itemId" value={current.itemId} />
          <p className="text-sm font-medium">{current.itemName}</p>
        </>
      ) : (
        <Field label="Item" htmlFor="kl-item"><Select id="kl-item" name="itemId" required defaultValue=""><option value="" disabled>Choose an item…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How many belong in the kit" htmlFor="kl-qty"><Input id="kl-qty" name="expectedQty" inputMode="decimal" defaultValue={current ? String(current.expectedQty) : "1"} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="isRequired" defaultChecked={current ? current.required : true} /> Required for the kit to be complete</label>
      </div>
      <Field label="Note (optional)" htmlFor="kl-note"><Input id="kl-note" name="note" defaultValue={current?.note ?? ""} maxLength={300} /></Field>
      {current ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove" /> Remove this line from the checklist (only when nothing of it is packed)</label> : null}
    </ActionForm>
  );
}
