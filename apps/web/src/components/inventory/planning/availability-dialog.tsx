"use client";

import { useRef, useState } from "react";
import { checkAvailability, type AvailabilityAnswer } from "@/lib/actions/inventoryPlanning";
import { itemAvailabilityWords, num, asRecord, technologyAvailabilityWords, type AvailabilityLine, type Tone } from "@/lib/inventory/planning";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Field } from "./inv-form";
import { ItemPicker } from "./pickers";
import { TONE_TEXT } from "./status";

export interface AvailabilityScope {
  companies: { id: string; name: string }[];
  locations: { id: string; name: string; companyId: string; timezone: string }[];
  technologies: { id: string; name: string; companyId: string }[];
}

/**
 * "What is free?": an item or a technology template, a quantity, a place and a date range. The answer keeps two questions apart and
 * labels them: how things stand NOW at the location, and what is free FOR THOSE DATES. Overdue equipment is flagged and never counted
 * as ready. This only looks; it reserves nothing.
 */
export function AvailabilityButton({ scope, label = "Check availability", defaults }: { scope: AvailabilityScope; label?: string; defaults?: { companyId?: string; locationId?: string; from?: string; until?: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>{label}</Button>
      {open ? <AvailabilityDialog scope={scope} defaults={defaults} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AvailabilityDialog({ scope, defaults, onClose }: { scope: AvailabilityScope; defaults?: { companyId?: string; locationId?: string; from?: string; until?: string }; onClose: () => void }) {
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? scope.companies[0]?.id ?? "");
  const locations = scope.locations.filter((l) => l.companyId === companyId);
  const [locationId, setLocationId] = useState(defaults?.locationId && locations.some((l) => l.id === defaults.locationId) ? defaults.locationId : (locations[0]?.id ?? ""));
  const [kind, setKind] = useState<"item" | "technology">("item");
  const [itemId, setItemId] = useState("");
  const [techId, setTechId] = useState("");
  const [qty, setQty] = useState("1");
  const [from, setFrom] = useState(defaults?.from ?? "");
  const [until, setUntil] = useState(defaults?.until ?? "");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AvailabilityAnswer | null>(null);
  const busy = useRef(false);
  const techs = scope.technologies.filter((t) => t.companyId === companyId);
  const loc = locations.find((l) => l.id === locationId);

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      setAnswer(await checkAvailability({ kind, id: kind === "item" ? itemId : techId, qty: Number(qty), locationId, from, until }));
    } catch {
      setAnswer({ error: "The check could not be made. Try again." });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="wide" title="Check availability" description="What could be promised for a place and a date range. This only looks: it reserves nothing.">
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="space-y-4">
        {scope.companies.length > 1 ? (
          <Field label="Company" htmlFor="av-company">
            <Select id="av-company" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setLocationId(scope.locations.find((l) => l.companyId === e.target.value)?.id ?? ""); setItemId(""); setTechId(""); }}>
              {scope.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">What do you want to check</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" checked={kind === "item"} onChange={() => { setKind("item"); setItemId(""); setAnswer(null); }} /> One item</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" checked={kind === "technology"} onChange={() => { setKind("technology"); setAnswer(null); }} /> A technology template</label>
        </fieldset>
        {kind === "item" ? (
          <ItemPicker key={companyId} companyId={companyId} name="availabilityItem" onPick={(i) => { setItemId(i?.id ?? ""); setAnswer(null); }} />
        ) : (
          <Field label="Technology template" htmlFor="av-tech">
            <Select id="av-tech" value={techId} onChange={(e) => { setTechId(e.target.value); setAnswer(null); }}>
              <option value="">Choose a template</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "item" ? "Quantity needed" : "How many"} htmlFor="av-qty"><Input id="av-qty" type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
          <Field label="Location" htmlFor="av-loc">
            <Select id="av-loc" value={locationId} onChange={(e) => { setLocationId(e.target.value); setAnswer(null); }} required>
              {locations.length === 0 ? <option value="">No location available</option> : null}
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="From" htmlFor="av-from"><Input id="av-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
          <Field label="Until" htmlFor="av-until"><Input id="av-until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} required /></Field>
        </div>
        {loc ? <p className="text-sm text-muted-foreground">Dates are local time at {loc.name} ({loc.timezone}).</p> : null}
        <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Checking…" : "Check"}</Button></div>
      </form>
      <div aria-live="polite" className="mt-4">
        {answer?.error ? <Alert variant="destructive" role="alert">{answer.error}</Alert> : null}
        {answer && !answer.error && answer.kind === "item" ? <ItemResult result={answer.result} timeZone={answer.timeZone ?? "UTC"} qty={Number(qty)} /> : null}
        {answer && !answer.error && answer.kind === "technology" ? <TechnologyResult result={answer.result} /> : null}
      </div>
    </Modal>
  );
}

function Lines({ title, note, lines }: { title: string; note?: string; lines: AvailabilityLine[] }) {
  return (
    <section className="rounded-lg border border-border">
      <h3 className="border-b border-border bg-secondary/40 px-3 py-2 text-sm font-semibold">{title}</h3>
      {note ? <p className="px-3 pt-2 text-sm text-muted-foreground">{note}</p> : null}
      <dl className="divide-y divide-border">
        {lines.map((l) => (
          <div key={l.label} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5 text-sm">
            <dt className="min-w-0">{l.label}{l.note ? <span className="block text-[13px] text-muted-foreground">{l.note}</span> : null}</dt>
            <dd className={`font-medium tabular-nums ${TONE_TEXT[l.tone]}`}>{l.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ItemResult({ result, timeZone, qty }: { result: unknown; timeZone: string; qty: number }) {
  const w = itemAvailabilityWords(result, timeZone);
  const free = num(asRecord(result).free_for_range);
  const enough = Number.isFinite(qty) && qty > 0 ? free >= qty : null;
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{w.title}</h3>
      {enough !== null ? <Alert role="status" variant={enough ? "success" : "warning"}>{enough ? `Enough is free for those dates: ${free} free, ${qty} needed.` : `Not enough is free for those dates: ${free} free, ${qty} needed.`}</Alert> : null}
      {w.overdue ? <Alert variant="warning" role="status">{w.overdue.text}</Alert> : null}
      <Lines title="Right now" lines={w.now} />
      <Lines title="For those dates" note={w.basisNote} lines={w.range} />
      {w.units.length > 0 ? (
        <section className="rounded-lg border border-border">
          <h3 className="border-b border-border bg-secondary/40 px-3 py-2 text-sm font-semibold">Individual units</h3>
          <ul className="divide-y divide-border">
            {w.units.map((u) => (
              <li key={u.id} className="px-3 py-1.5 text-sm">
                <span className="font-medium">{u.code}</span>{u.serial ? ` · serial ${u.serial}` : ""}
                <span className={`ml-2 ${u.free ? TONE_TEXT.good : "text-muted-foreground"}`}>{u.free ? "Free for those dates" : (u.reason ?? "Not free")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function TechnologyResult({ result }: { result: unknown }) {
  const w = technologyAvailabilityWords(result);
  const r = asRecord(result);
  const variant: Record<Tone, "success" | "warning" | "destructive" | "default"> = { good: "success", warn: "warning", bad: "destructive", plain: "default" };
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{String(r.name ?? "Technology")}</h3>
      <Alert role="status" variant={variant[w.tone]}>
        <strong>{w.headline}</strong>
        {w.message && w.message !== w.headline ? ` — ${w.message}` : ""}
        {r.template_status && r.template_status !== "complete" ? " The template is not complete, so nothing is promised." : ""}
        {w.needsSubstitution ? " Part of it would need a listed alternative that the project manager must accept." : ""}
      </Alert>
      {w.rows.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {w.rows.map((row) => (
            <li key={row.item} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5 text-sm">
              <span className="min-w-0 break-words font-medium">{row.item}{row.note ? <span className="block text-[13px] font-normal text-muted-foreground">{row.note}</span> : null}</span>
              <span className={TONE_TEXT[row.tone]}>needs {row.needed}, {row.free} free: {row.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-muted-foreground">This is for the dates you asked about, and counts what would be free then. It does not reserve anything.</p>
    </div>
  );
}
