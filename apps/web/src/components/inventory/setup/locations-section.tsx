"use client";

import { useEffect, useState } from "react";
import { saveInventoryBin, saveInventoryLocation } from "@/lib/actions/inventorySetup";
import { COMMON_TIMEZONES, isValidTimezone, missingSuggestions, normaliseLocationCode, timezonePreview, type LocationSuggestion } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm, Field } from "@/components/sales/action-form";

export interface LocationView { id: string; code: string; name: string; kind: "warehouse" | "office" | "other"; timezone: string; address: string | null; isActive: boolean }
export interface BinView { id: string; locationId: string; code: string; label: string | null; isActive: boolean }

const KIND_WORDS = { warehouse: "Warehouse", office: "Office", other: "Other place" } as const;
interface Draft { id: string | null; code: string; name: string; kind: LocationView["kind"]; timezone: string; address: string; isActive: boolean }
const EMPTY: Draft = { id: null, code: "", name: "", kind: "warehouse", timezone: "", address: "", isActive: true };

/** The local time at a place, set after the page has loaded (so the server and the browser never disagree about "now"). */
export function TimePreview({ timezone }: { timezone: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setText(timezonePreview(timezone));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [timezone]);
  if (!timezone.trim()) return null;
  if (!isValidTimezone(timezone)) return <p className="text-sm text-destructive">That is not a time zone name. Use one from the list, or a name such as Asia/Dubai.</p>;
  return text ? <p className="text-sm text-muted-foreground">Local time there now: <strong className="text-foreground">{text}</strong>. Dates typed for this place are read in this time zone.</p> : null;
}

function LocationForm({ companyId, draft, onDone }: { companyId: string; draft: Draft; onDone: () => void }) {
  const [name, setName] = useState(draft.name);
  const [code, setCode] = useState(draft.code);
  const [codeTouched, setCodeTouched] = useState(draft.code !== "");
  const listed = COMMON_TIMEZONES.some((t) => t.value === draft.timezone);
  const [tzChoice, setTzChoice] = useState(draft.timezone === "" ? "" : listed ? draft.timezone : "__other");
  const [tzOther, setTzOther] = useState(listed ? "" : draft.timezone);
  const timezone = tzChoice === "__other" ? tzOther.trim() : tzChoice;
  return (
    <ActionForm action={saveInventoryLocation} submitLabel={draft.id ? "Save location" : "Add location"} onDone={onDone} secondary={<Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}>
      <input type="hidden" name="companyId" value={companyId} />
      {draft.id ? <input type="hidden" name="locationId" value={draft.id} /> : null}
      <input type="hidden" name="timezone" value={timezone} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="inv-loc-name"><Input id="inv-loc-name" name="name" required maxLength={80} value={name} onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(normaliseLocationCode(e.target.value).slice(0, 3)); }} /></Field>
        <Field label="Short code" htmlFor="inv-loc-code" hint="2 to 8 capital letters or digits."><Input id="inv-loc-code" name="code" required minLength={2} maxLength={8} pattern="[A-Za-z0-9]{2,8}" className="uppercase" value={code} onChange={(e) => { setCodeTouched(true); setCode(normaliseLocationCode(e.target.value)); }} autoComplete="off" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" htmlFor="inv-loc-kind">
          <Select id="inv-loc-kind" name="kind" defaultValue={draft.kind}>{(Object.keys(KIND_WORDS) as (keyof typeof KIND_WORDS)[]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}</Select>
        </Field>
        <Field label="Time zone" htmlFor="inv-loc-tz">
          <Select id="inv-loc-tz" value={tzChoice} onChange={(e) => setTzChoice(e.target.value)} required>
            <option value="" disabled>Choose a time zone…</option>
            {COMMON_TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label} · {t.value}</option>)}
            <option value="__other">Other (type the name)…</option>
          </Select>
        </Field>
      </div>
      {tzChoice === "__other" ? <Field label="Time zone name" htmlFor="inv-loc-tz-other" hint="An IANA name such as Africa/Casablanca."><Input id="inv-loc-tz-other" value={tzOther} onChange={(e) => setTzOther(e.target.value)} autoComplete="off" spellCheck={false} /></Field> : null}
      <TimePreview timezone={timezone} />
      <Field label="Address (optional)" htmlFor="inv-loc-address"><Input id="inv-loc-address" name="address" defaultValue={draft.address} maxLength={300} /></Field>
      {draft.id ? (
        <Field label="Status" htmlFor="inv-loc-active" hint="A location can only be switched off when it holds no stock and has no transfers on the way.">
          <Select id="inv-loc-active" name="isActive" defaultValue={String(draft.isActive)}><option value="true">In use</option><option value="false">Switched off</option></Select>
        </Field>
      ) : null}
    </ActionForm>
  );
}

function BinsDialog({ location, bins, canEdit, onClose }: { location: LocationView; bins: readonly BinView[]; canEdit: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState<BinView | "new" | null>(null);
  const mine = bins.filter((b) => b.locationId === location.id);
  return (
    <Modal open onClose={onClose} title={`Bins at ${location.name}`} description="A bin is a shelf, box or cage position. Counted stock is held per item and bin.">
      <div className="space-y-4">
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">No bins yet.{canEdit ? " Add one below." : ""}</p> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {mine.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0"><p className="break-words text-sm font-medium">{b.code}{b.label ? <span className="font-normal text-muted-foreground"> · {b.label}</span> : null}</p>{!b.isActive ? <p className="text-sm text-muted-foreground">Switched off</p> : null}</div>
                {canEdit ? <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(b)}>Edit<span className="sr-only"> bin {b.code}</span></Button> : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          editing ? (
            <ActionForm key={editing === "new" ? "new" : editing.id} action={saveInventoryBin} submitLabel={editing === "new" ? "Add bin" : "Save bin"} resetOnSuccess onDone={() => setEditing(null)} secondary={<Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>}>
              <input type="hidden" name="locationId" value={location.id} />
              {editing !== "new" ? <input type="hidden" name="binId" value={editing.id} /> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bin code" htmlFor="inv-bin-code"><Input id="inv-bin-code" name="code" required maxLength={30} defaultValue={editing === "new" ? "" : editing.code} autoComplete="off" /></Field>
                <Field label="Description (optional)" htmlFor="inv-bin-label"><Input id="inv-bin-label" name="label" maxLength={80} defaultValue={editing === "new" ? "" : (editing.label ?? "")} /></Field>
              </div>
              {editing !== "new" ? (
                <Field label="Status" htmlFor="inv-bin-active" hint="A bin can only be switched off when it is empty.">
                  <Select id="inv-bin-active" name="isActive" defaultValue={String(editing.isActive)}><option value="true">In use</option><option value="false">Switched off</option></Select>
                </Field>
              ) : null}
            </ActionForm>
          ) : <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")}>Add a bin</Button>
        ) : <p className="text-sm text-muted-foreground">Catalogue rights are needed to change bins.</p>}
      </div>
    </Modal>
  );
}

export function LocationsSection({ companyId, locations, bins, isFounder, canEditBins }: { companyId: string; locations: readonly LocationView[]; bins: readonly BinView[]; isFounder: boolean; canEditBins: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [binsFor, setBinsFor] = useState<string | null>(null);
  const suggestions = isFounder ? missingSuggestions(locations) : [];
  const open = (s?: LocationSuggestion) => setDraft(s ? { ...EMPTY, name: s.name, code: s.code, timezone: s.timezone } : EMPTY);
  const binLocation = locations.find((l) => l.id === binsFor) ?? null;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">Each place that keeps equipment is a location with its own time zone. Only a founder adds or changes locations. Nothing is set up for you: a location exists only after a founder has saved it.</p>
      {isFounder ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => open()}>Add a location</Button>
          {suggestions.length > 0 ? <span className="text-sm text-muted-foreground">Suggestions (nothing is saved until you confirm):</span> : null}
          {suggestions.map((s) => <Button key={s.code} type="button" size="sm" variant="outline" onClick={() => open(s)}>Add {s.name}</Button>)}
        </div>
      ) : null}
      {locations.length === 0 ? (
        <EmptyState dense title="No locations yet." description={isFounder ? "Add the first location, or use one of the suggestions above." : "A founder needs to add the first location."} />
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Code</TableHead><TableHead>Kind</TableHead><TableHead>Time zone</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {locations.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.name}{l.address ? <span className="block text-sm font-normal text-muted-foreground">{l.address}</span> : null}</TableCell>
                <TableCell>{l.code}</TableCell>
                <TableCell>{KIND_WORDS[l.kind]}</TableCell>
                <TableCell>{l.timezone}</TableCell>
                <TableCell>{l.isActive ? <Badge variant="outline">In use</Badge> : <Badge variant="warning">Switched off</Badge>}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBinsFor(l.id)}>Bins ({bins.filter((b) => b.locationId === l.id).length})<span className="sr-only"> at {l.name}</span></Button>
                    {isFounder ? <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ id: l.id, code: l.code, name: l.name, kind: l.kind, timezone: l.timezone, address: l.address ?? "", isActive: l.isActive })}>Edit<span className="sr-only">{` ${l.name}`}</span></Button> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {draft ? (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? `Edit ${draft.name}` : "Add a location"} description={draft.id ? undefined : draft.name ? "Check the details, then confirm. Nothing is saved until you do." : "A place that keeps equipment."} size="wide">
          <LocationForm companyId={companyId} draft={draft} onDone={() => setDraft(null)} />
        </Modal>
      ) : null}
      {binLocation ? <BinsDialog location={binLocation} bins={bins} canEdit={canEditBins} onClose={() => setBinsFor(null)} /> : null}
      {!isFounder && locations.length > 0 ? <Alert role="status">Only a founder can add or change locations. You can change bins.</Alert> : null}
    </div>
  );
}
