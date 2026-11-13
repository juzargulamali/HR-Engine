import { DP_SECTIONS, DP_SECTION_LABELS, DP_SECTION_SHEET_NAMES, canEditSection, type DeliveryPlan, type DpItem, type DpLine, type DpSection } from "../model";
import type { DpSheet, ParsedItemRow, ParsedLineRow, ParsedPlanWorkbook } from "./parse";

/**
 * The pure planner of the Delivery Plan import: the parsed workbook against the current plan gives, for every row, Add, Update, Unchanged or Needs attention, and the
 * exact payload `proj_dp_apply_import` takes. No database, no file reading, no React (the import screen uses `effectiveStatus` from here).
 *
 * The rules, all mirrored from supabase/migrations/20261231000100_proj_delivery_plan.sql (the database repeats every one of them):
 *  - A row is the record its ID names; without an ID it is the record with the same zone + name (deliverable) or deliverable + section + description (line); else new.
 *  - A blank cell leaves the value as it is. A row that is not in the workbook is left alone. Nothing is ever cleared or removed by an import.
 *  - A name (owner, assignee, stock item) must fit exactly one record; otherwise the person chooses, or skips that field, before anything can be confirmed.
 *  - A change to a released row is sent, and the database turns it into a proposal. A change to equipment that is with the warehouse is never sent.
 *  - Without manage rights only lines of the person's delegated sections may change.
 */
export interface Named { id: string; name: string }
/** ref -> the chosen id, or "skip" to leave that field as it is. */
export type Resolutions = Record<string, string>;
export type RowStatus = "add" | "update" | "unchanged" | "attention";

export interface RowIssue { field: string; message: string }
export interface RowChange { field: string; from: string; to: string }
export interface RowChoice {
  /** Stable for the same workbook: "Deliverables!7:owner", "Breakdown!12:assignee", "Breakdown!12:stock". */
  ref: string; field: string; typed: string; kind: "person" | "stock"; reason: "unknown" | "ambiguous"; message: string; candidates: Named[];
  /** The id recorded now (choosing it changes nothing). */
  current: string | null;
}
export interface PreviewRow {
  sheet: DpSheet; row: number; kind: "deliverable" | "line"; key: string | null; label: string;
  status: RowStatus;
  /** What the row is once its choices are answered with "skip". */
  baseStatus: Exclude<RowStatus, "attention">;
  changes: RowChange[]; issues: RowIssue[]; choices: RowChoice[];
  /** The record is already released: a change becomes a proposal for the Project Manager. */
  released: boolean;
  /** True when the cells themselves (not a choice) change something that needs approval on a released record. */
  proposes: boolean;
}
export interface PayloadItem { ref: string; id: string | null; fields: Record<string, string | number> }
export interface PayloadLine { item_ref: string | null; item_id: string | null; id: string | null; fields: Record<string, string | number> }
export interface ImportPlan {
  summary: { add: number; update: number; unchanged: number; attention: number };
  rows: PreviewRow[];
  payload: { items: PayloadItem[]; lines: PayloadLine[] };
  /** Things the person should know that do not block the import (for example a cell too long to read, which is left as it is). */
  warnings: string[];
}
export interface PlanInput {
  workbook: Pick<ParsedPlanWorkbook, "items" | "lines">;
  plan: Pick<DeliveryPlan, "can_manage" | "my_sections" | "items">;
  people: readonly Named[];
  /** null = the stock list could not be loaded (or Inventory is not installed): a named stock item then needs attention, it is never ignored. */
  inventory: readonly Named[] | null;
  resolutions?: Resolutions;
}

export const ONLY_PM = "Only the Project Manager can change this";
export const WITH_WAREHOUSE = "This equipment is already with the warehouse. Change it on the Equipment tab.";
export const NO_STOCK_LIST = "Could not load the stock list, so this stock item cannot be matched";
export const PROPOSED_NOTE = "Will be proposed to the Project Manager (already released)";

/** The status of a row under the given answers. One rule for the server and the screen. */
export function effectiveStatus(row: Pick<PreviewRow, "issues" | "choices" | "baseStatus">, resolutions: Resolutions): RowStatus {
  if (row.issues.length > 0) return "attention";
  let changed = false;
  for (const c of row.choices) {
    const v = resolutions[c.ref];
    if (v === "skip") continue;
    if (!v || !c.candidates.some((x) => x.id === v)) return "attention";
    if (v !== c.current) changed = true;
  }
  return row.baseStatus === "unchanged" && changed ? "update" : row.baseStatus;
}
/** Does this row, under the given answers, become a proposal instead of a direct change? */
export function willPropose(row: Pick<PreviewRow, "issues" | "choices" | "baseStatus" | "released" | "proposes">, resolutions: Resolutions): boolean {
  if (!row.released || effectiveStatus(row, resolutions) !== "update") return false;
  return row.proposes || row.choices.some((c) => { const v = resolutions[c.ref]; return !!v && v !== "skip" && v !== c.current; });
}

const low = (s: string) => s.trim().toLowerCase();
const words = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const text = (s: string | null | undefined) => (s ?? "").replace(/\r\n?/g, "\n").trim();
const nameKey = (zone: string, title: string) => `${low(zone)}\u0001${low(title)}`;
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);
const itemLabel = (zone: string, title: string) => (zone.trim() ? `${zone.trim()} / ${title.trim()}` : title.trim() || "(no name)");

const SECTION_BY_WORD = new Map<string, DpSection>([
  ...DP_SECTIONS.flatMap((s) => [[s, s], [words(DP_SECTION_SHEET_NAMES[s]), s], [words(DP_SECTION_LABELS[s]), s], [words(DP_SECTION_LABELS[s]).replace(/\s*\/\s*/g, "/"), s]] as [string, DpSection][]),
  // Names a workbook made before Release 1 may carry.
  ["content / ui / ux", "content"], ["content/ui/ux", "content"], ["engineering & integration", "engineering"], ["engineering and integration", "engineering"], ["site", "site"], ["site work", "site"],
]);
export const parseSection = (s: string): DpSection | null => SECTION_BY_WORD.get(words(s)) ?? SECTION_BY_WORD.get(words(s).replace(/\s*\/\s*/g, "/")) ?? null;

type Fields = Record<string, string | number>;
interface Draft {
  row: PreviewRow; fields: Fields; existingId: string | null;
  /** For a line: the deliverable it sits under. */
  itemId?: string | null; itemRef?: string | null; itemDraft?: Draft | null;
  /** How each choice is written to the payload once answered. */
  choiceField: Record<string, string>;
  section?: DpSection | null;
}

/** A typed name against a list: the one record it names, nothing to change, or a choice for the person. */
function lookup(o: {
  kind: "person" | "stock"; ref: string; field: string; typed: string; list: readonly Named[]; currentId: string | null; currentName: string | null;
}): { same: true } | { id: string; name: string } | { choice: RowChoice } {
  if (o.currentName && words(o.typed) === words(o.currentName)) return { same: true };
  const exact = o.list.filter((x) => words(x.name) === words(o.typed));
  if (exact.length === 1) return exact[0]!.id === o.currentId ? { same: true } : { id: exact[0]!.id, name: exact[0]!.name };
  const what = o.kind === "person" ? "member of this project" : "stock item";
  if (exact.length > 1) {
    return { choice: { ref: o.ref, field: o.field, typed: o.typed, kind: o.kind, reason: "ambiguous", current: o.currentId, candidates: exact.map((x) => ({ id: x.id, name: x.name })),
      message: `"${o.typed}" is ambiguous: more than one ${what} has this name. Choose which one, or skip to leave it as it is.` } };
  }
  const candidates = o.kind === "person" ? o.list.map((x) => ({ id: x.id, name: x.name })) : o.list.filter((x) => words(x.name).includes(words(o.typed))).slice(0, 5).map((x) => ({ id: x.id, name: x.name }));
  return { choice: { ref: o.ref, field: o.field, typed: o.typed, kind: o.kind, reason: "unknown", current: o.currentId, candidates,
    message: candidates.length > 0 ? `"${o.typed}" is not the name of a ${what}. Choose one, or skip to leave it as it is.` : `"${o.typed}" is not the name of a ${what}. Skip to leave it as it is, or correct the workbook.` } };
}

export function planDeliveryImport(input: PlanInput): ImportPlan {
  const { workbook, plan, people, inventory } = input;
  const resolutions = input.resolutions ?? {};
  const warnings: string[] = [];
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const stockName = new Map((inventory ?? []).map((p) => [p.id, p.name]));

  const itemByKey = new Map(plan.items.map((i) => [i.key.toUpperCase(), i]));
  const itemByName = new Map(plan.items.map((i) => [nameKey(i.zone, i.title), i]));
  const lineByKey = new Map<string, { line: DpLine; item: DpItem }>();
  for (const item of plan.items) for (const line of item.lines) lineByKey.set(line.key.toUpperCase(), { line, item });

  const tooLong = (sheet: DpSheet, row: number, fields: readonly string[], label: Record<string, string>) => {
    for (const f of fields) warnings.push(`${sheet}, row ${row}, ${label[f] ?? f}: a cell of 2000 characters or more cannot be read from a workbook, so it is left as it is. Change it on the Delivery plan.`);
  };

  // ------------------------------------------------------------------------------------------------------------------------------------------------ Deliverables
  const ITEM_LABEL: Record<string, string> = { id: "Deliverable ID", zone: "Zone", title: "Deliverable", specs: "Specifications", owner: "Accountable owner", neededBy: "Needed by" };
  const itemDrafts: Draft[] = [];
  const seenItem = new Map<string, number>();
  const seenNewItem = new Map<string, number>();

  for (const r of workbook.items) {
    const issues: RowIssue[] = []; const changes: RowChange[] = []; const choices: RowChoice[] = []; const fields: Fields = {}; const choiceField: Record<string, string> = {};
    tooLong("Deliverables", r.row, r.tooLong, ITEM_LABEL);
    let existing: DpItem | undefined;
    if (r.id) {
      existing = itemByKey.get(r.id.toUpperCase());
      if (!existing) issues.push({ field: "Deliverable ID", message: `${r.id}: this ID is not in this project's plan. Leave the ID empty to add a new deliverable.` });
    } else if (!r.title) issues.push({ field: "Deliverable", message: "Give the deliverable a name" });
    else existing = itemByName.get(nameKey(r.zone, r.title));

    if (existing) {
      const before = seenItem.get(existing.id);
      if (before) issues.push({ field: "Row", message: `This is the same deliverable as row ${before}. Keep one row.` }); else seenItem.set(existing.id, r.row);
    } else if (!r.id && r.title) {
      const k = nameKey(r.zone, r.title); const before = seenNewItem.get(k);
      if (before) issues.push({ field: "Row", message: `This is the same deliverable as row ${before}. Keep one row.` }); else seenNewItem.set(k, r.row);
    }
    const set = (dbField: string, label: string, from: string, to: string, value: string | number = to) => { fields[dbField] = value; changes.push({ field: label, from, to }); };
    if (r.zone.length > 120) issues.push({ field: "Zone", message: "Zone is longer than 120 characters" });
    else if (r.zone && r.zone !== text(existing?.zone)) set("zone", "Zone", text(existing?.zone), r.zone);
    if (r.title.length > 200) issues.push({ field: "Deliverable", message: "Deliverable is longer than 200 characters" });
    else if (r.title && r.title !== text(existing?.title)) set("title", "Deliverable", text(existing?.title), r.title);
    if (r.specs && text(r.specs) !== text(existing?.specs)) set("specs", "Specifications", text(existing?.specs), text(r.specs));
    if (r.neededBy && !r.neededByIso) issues.push({ field: "Needed by", message: `"${r.neededBy}" is not a valid date: use yyyy-mm-dd, for example 2026-11-30` });
    else if (r.neededByIso && r.neededByIso !== (existing?.needed_by ?? "")) set("needed_by", "Needed by", existing?.needed_by ?? "", r.neededByIso);
    if (r.owner) {
      const found = lookup({ kind: "person", ref: `Deliverables!${r.row}:owner`, field: "Accountable owner", typed: r.owner, list: people, currentId: existing?.owner_id ?? null,
        currentName: existing?.owner_id ? existing.owner_name ?? personName.get(existing.owner_id) ?? null : null });
      if ("id" in found) set("owner_id", "Accountable owner", existing?.owner_id ? existing.owner_name ?? personName.get(existing.owner_id) ?? "Someone" : "", found.name, found.id);
      else if ("choice" in found) { choices.push(found.choice); choiceField[found.choice.ref] = "owner_id"; }
    }
    const row: PreviewRow = {
      sheet: "Deliverables", row: r.row, kind: "deliverable", key: existing?.key ?? null, label: itemLabel(r.zone || existing?.zone || "", r.title || existing?.title || ""),
      status: "attention", baseStatus: existing ? (Object.keys(fields).length > 0 ? "update" : "unchanged") : "add", changes, issues, choices,
      released: !!existing?.released_at, proposes: !!existing?.released_at && Object.keys(fields).length > 0,
    };
    if (!plan.can_manage && (row.baseStatus !== "unchanged" || choices.length > 0 || issues.length > 0)) { row.issues = [{ field: "Row", message: ONLY_PM }]; row.choices = []; }
    itemDrafts.push({ row, fields, existingId: existing?.id ?? null, choiceField });
  }

  // Two deliverables may not end with the same zone and name (the database refuses it, and one refusal stops the whole import).
  const finalName = new Map<string, string>(plan.items.map((i) => [i.id, nameKey(i.zone, i.title)]));
  const finalOf = (d: Draft, r: ParsedItemRow) => {
    const cur = d.existingId ? plan.items.find((i) => i.id === d.existingId) : undefined;
    return nameKey(String(d.fields.zone ?? cur?.zone ?? r.zone), String(d.fields.title ?? cur?.title ?? r.title));
  };
  itemDrafts.forEach((d, n) => finalName.set(d.existingId ?? `row:${d.row.row}`, finalOf(d, workbook.items[n]!)));
  const holders = new Map<string, number>();
  for (const k of finalName.values()) holders.set(k, (holders.get(k) ?? 0) + 1);
  itemDrafts.forEach((d, n) => {
    const renamed = "zone" in d.fields || "title" in d.fields;
    if (d.row.issues.length === 0 && renamed && (holders.get(finalOf(d, workbook.items[n]!)) ?? 0) > 1) d.row.issues.push({ field: "Deliverable", message: "Another deliverable in this zone already has that name" });
  });
  for (const d of itemDrafts) d.row.status = effectiveStatus(d.row, resolutions);

  // A Breakdown row finds a deliverable of this workbook by the name it will have, or by the name typed on its row.
  const draftByName = new Map<string, Draft>();
  itemDrafts.forEach((d, n) => {
    const r = workbook.items[n]!;
    for (const k of [finalOf(d, r), ...(r.title ? [nameKey(r.zone, r.title)] : [])]) if (!draftByName.has(k)) draftByName.set(k, d);
  });

  // --------------------------------------------------------------------------------------------------------------------------------------------------- Breakdown
  const LINE_LABEL: Record<string, string> = { id: "Line ID", itemId: "Deliverable ID", zone: "Zone", title: "Deliverable", section: "Section", description: "Description", qty: "Quantity", stockItem: "Stock item", assignee: "Assigned to", neededBy: "Needed by", notes: "Notes" };
  const lineDrafts: Draft[] = [];
  const seenLine = new Map<string, number>();

  for (const r of workbook.lines) {
    const issues: RowIssue[] = []; const changes: RowChange[] = []; const choices: RowChoice[] = []; const fields: Fields = {}; const choiceField: Record<string, string> = {};
    tooLong("Breakdown", r.row, r.tooLong, LINE_LABEL);
    let existing: DpLine | undefined; let item: DpItem | undefined; let itemDraft: Draft | null = null;
    const typedSection = r.section ? parseSection(r.section) : null;
    if (r.section && !typedSection) issues.push({ field: "Section", message: `"${r.section}" is not a section. Choose Hardware, Content, Programming, Installation or Testing.` });

    if (r.id) {
      const hit = lineByKey.get(r.id.toUpperCase());
      if (!hit) issues.push({ field: "Line ID", message: `${r.id}: this ID is not in this project's plan. Leave the ID empty to add a new line.` });
      else {
        existing = hit.line; item = hit.item;
        if (r.itemId && r.itemId.toUpperCase() !== item.key.toUpperCase()) issues.push({ field: "Deliverable ID", message: `This line belongs to ${item.key}. A line cannot be moved to another deliverable.` });
        if (typedSection && typedSection !== existing.section) issues.push({ field: "Section", message: `This line is in ${DP_SECTION_SHEET_NAMES[existing.section]}. A line cannot be moved to another section.` });
      }
    } else {
      if (r.itemId) {
        item = itemByKey.get(r.itemId.toUpperCase());
        if (!item) issues.push({ field: "Deliverable ID", message: `${r.itemId}: this ID is not in this project's plan.` });
      } else if (r.title) {
        const d = draftByName.get(nameKey(r.zone, r.title));
        if (d?.existingId) item = plan.items.find((i) => i.id === d.existingId);
        else if (d) itemDraft = d;
        else item = itemByName.get(nameKey(r.zone, r.title));
        if (!item && !itemDraft) issues.push({ field: "Deliverable", message: `No deliverable named "${itemLabel(r.zone, r.title)}" is on the Deliverables sheet or in the plan.` });
      } else issues.push({ field: "Deliverable ID", message: "Give the Deliverable ID, or the Zone and Deliverable of a row on the Deliverables sheet." });
      if (!r.section) issues.push({ field: "Section", message: "Choose the section: Hardware, Content, Programming, Installation or Testing" });
      if (!r.description) issues.push({ field: "Description", message: "Describe the line" });
      if (item && typedSection && r.description) existing = item.lines.find((l) => l.section === typedSection && low(l.description) === low(r.description));
      if (itemDraft && itemDraft.row.issues.length > 0) issues.push({ field: "Deliverable", message: `Its deliverable (Deliverables, row ${itemDraft.row.row}) needs attention first.` });
    }
    const section = existing?.section ?? typedSection;
    const dupKey = existing ? existing.id : section && r.description && (item || itemDraft) ? `${item?.id ?? `row:${itemDraft!.row.row}`}\u0001${section}\u0001${low(r.description)}` : null;
    if (dupKey) { const before = seenLine.get(dupKey); if (before) issues.push({ field: "Row", message: `This is the same line as row ${before}. Keep one row.` }); else seenLine.set(dupKey, r.row); }

    const set = (dbField: string, label: string, from: string, to: string, value: string | number = to) => { fields[dbField] = value; changes.push({ field: label, from, to }); };
    if (!existing && section) fields.section = section;
    if (r.description.length > 300) issues.push({ field: "Description", message: "Description is longer than 300 characters" });
    else if (r.description && r.description !== text(existing?.description)) {
      if (existing && item && item.lines.some((l) => l.id !== existing!.id && l.section === existing!.section && low(l.description) === low(r.description))) issues.push({ field: "Description", message: "This deliverable already has that line in this section" });
      else set("description", "Description", text(existing?.description), r.description);
    }
    if (r.qty) {
      const n = Math.round(Number(r.qty) * 1000) / 1000;
      if (!Number.isFinite(n) || n <= 0 || n >= 1e11) issues.push({ field: "Quantity", message: `"${r.qty}" is not a quantity: use a number more than zero` });
      else if (existing?.qty == null || Number(existing.qty) !== n) set("qty", "Quantity", existing?.qty == null ? "" : qtyText(Number(existing.qty)), qtyText(n), n);
    }
    if (r.stockItem) {
      if (section && section !== "hardware") issues.push({ field: "Stock item", message: "Only a Hardware line names a stock item" });
      // The name already recorded on the line is not a change: nothing to look up, whether or not the stock list can be read.
      else if (existing?.inv_item_id && existing.inv_item_name && words(r.stockItem) === words(existing.inv_item_name)) { /* same stock item */ }
      else if (!inventory) issues.push({ field: "Stock item", message: NO_STOCK_LIST });
      else {
        const found = lookup({ kind: "stock", ref: `Breakdown!${r.row}:stock`, field: "Stock item", typed: r.stockItem, list: inventory, currentId: existing?.inv_item_id ?? null,
          // The name recorded on the plan line comes first: the export writes that name, so an untouched export matches even when the person importing cannot read
          // the stock list (a delegated lead without Inventory access) or the item has since been retired.
          currentName: existing?.inv_item_id ? existing.inv_item_name ?? stockName.get(existing.inv_item_id) ?? null : null });
        if ("id" in found) set("inv_item_id", "Stock item", existing?.inv_item_id ? existing.inv_item_name ?? stockName.get(existing.inv_item_id) ?? "Another stock item" : "", found.name, found.id);
        else if ("choice" in found) { choices.push(found.choice); choiceField[found.choice.ref] = "inv_item_id"; }
      }
    }
    if (r.assignee) {
      const found = lookup({ kind: "person", ref: `Breakdown!${r.row}:assignee`, field: "Assigned to", typed: r.assignee, list: people, currentId: existing?.assignee_id ?? null,
        currentName: existing?.assignee_id ? existing.assignee_name ?? personName.get(existing.assignee_id) ?? null : null });
      if ("id" in found) set("assignee_id", "Assigned to", existing?.assignee_id ? existing.assignee_name ?? personName.get(existing.assignee_id) ?? "Someone" : "", found.name, found.id);
      else if ("choice" in found) { choices.push(found.choice); choiceField[found.choice.ref] = "assignee_id"; }
    }
    if (r.neededBy && !r.neededByIso) issues.push({ field: "Needed by", message: `"${r.neededBy}" is not a valid date: use yyyy-mm-dd, for example 2026-11-30` });
    else if (r.neededByIso && r.neededByIso !== (existing?.needed_by ?? "")) set("needed_by", "Needed by", existing?.needed_by ?? "", r.neededByIso);
    if (r.notes && text(r.notes) !== text(existing?.notes)) set("notes", "Notes", text(existing?.notes), text(r.notes));

    // Equipment that has left Draft is not changed from the plan at all (the database refuses every such change, quantity and stock item first of all).
    const booked = !!existing && existing.section === "hardware" && !!existing.equipment?.request_status && existing.equipment.request_status !== "draft";
    const needsApproval = Object.keys(fields).filter((f) => f !== "notes" && f !== "section");
    if (booked && (needsApproval.length > 0 || choices.length > 0)) {
      const label: Record<string, string> = { description: "Description", qty: "Quantity", inv_item_id: "Stock item", assignee_id: "Assigned to", needed_by: "Needed by" };
      for (const f of new Set([...needsApproval, ...choices.map((c) => choiceField[c.ref]!)])) issues.push({ field: label[f] ?? f, message: WITH_WAREHOUSE });
      choices.length = 0;
    }

    const changed = Object.keys(fields).some((f) => f !== "section");
    const row: PreviewRow = {
      sheet: "Breakdown", row: r.row, kind: "line", key: existing?.key ?? null,
      label: `${item?.key ? `${item.key} ` : ""}${(item?.title ?? r.title) || "(no deliverable)"}: ${section ? DP_SECTION_SHEET_NAMES[section] : "(no section)"}: ${r.description || existing?.description || "(no description)"}`,
      status: "attention", baseStatus: existing ? (changed ? "update" : "unchanged") : "add", changes, issues, choices,
      released: !!existing?.released_at, proposes: !!existing?.released_at && needsApproval.length > 0,
    };
    const allowed = section ? canEditSection(plan, section) : plan.can_manage;
    if (!allowed && (row.baseStatus !== "unchanged" || row.choices.length > 0 || row.issues.length > 0)) { row.issues = [{ field: "Row", message: ONLY_PM }]; row.choices = []; }
    row.status = effectiveStatus(row, resolutions);
    // A new line cannot be saved before its new deliverable is: while that row waits for an answer, so does this one.
    if (row.status !== "attention" && itemDraft && itemDraft.row.status === "attention") { row.issues.push({ field: "Deliverable", message: `Its deliverable (Deliverables, row ${itemDraft.row.row}) needs attention first.` }); row.status = "attention"; }
    lineDrafts.push({ row, fields, existingId: existing?.id ?? null, choiceField, itemId: item?.id ?? null, itemRef: itemDraft ? `Deliverables!${itemDraft.row.row}` : null, itemDraft, section });
  }

  // ----------------------------------------------------------------------------------------------------------------------------------------------------- Payload
  const answered = (d: Draft): Fields => {
    const out: Fields = { ...d.fields };
    for (const c of d.row.choices) { const v = resolutions[c.ref]; if (v && v !== "skip" && v !== c.current) out[d.choiceField[c.ref]!] = v; }
    return out;
  };
  const send = (d: Draft) => d.row.status === "add" || d.row.status === "update";
  const items: PayloadItem[] = itemDrafts.filter(send).map((d) => ({ ref: `Deliverables!${d.row.row}`, id: d.existingId, fields: answered(d) }));
  const lines: PayloadLine[] = lineDrafts.filter(send).map((d) => ({ item_ref: d.itemId ? null : d.itemRef ?? null, item_id: d.itemId ?? null, id: d.existingId, fields: answered(d) }));
  const rows = [...itemDrafts, ...lineDrafts].map((d) => d.row);
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return { summary: { add: count("add"), update: count("update"), unchanged: count("unchanged"), attention: count("attention") }, rows, payload: { items, lines }, warnings };
}
