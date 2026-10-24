/**
 * Pure helpers for Inventory setup (Manage), counts and Access. No React, no database: the pages and forms call these, and the unit
 * tests prove them. Plain words throughout; nothing here is pre-created data (no location, category or time zone is ever assumed).
 */
import type { InvCapability } from "@enginious-hr/domain";

// ---------------------------------------------------------------------------------------------------------------
// Time zones and location suggestions
// ---------------------------------------------------------------------------------------------------------------

/** A sensible short list for a location's time zone. Any other valid IANA name can still be typed in the "Other" box. */
export const COMMON_TIMEZONES: readonly { value: string; label: string }[] = [
  { value: "Asia/Dubai", label: "Dubai (UAE)" },
  { value: "Asia/Riyadh", label: "Riyadh (Saudi Arabia)" },
  { value: "Europe/Warsaw", label: "Warsaw / Poznan (Poland)" },
  { value: "Asia/Qatar", label: "Doha (Qatar)" },
  { value: "Asia/Bahrain", label: "Manama (Bahrain)" },
  { value: "Asia/Kuwait", label: "Kuwait" },
  { value: "Asia/Muscat", label: "Muscat (Oman)" },
  { value: "Africa/Cairo", label: "Cairo (Egypt)" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Europe/London", label: "London (United Kingdom)" },
  { value: "Europe/Berlin", label: "Berlin / Central Europe" },
  { value: "Europe/Istanbul", label: "Istanbul (Turkey)" },
  { value: "America/New_York", label: "New York (US Eastern)" },
  { value: "UTC", label: "UTC" },
];

export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** "UTC+4", "UTC+5:30", "UTC" for a zone at an instant; null for an unknown zone. */
export function utcOffsetLabel(tz: string, at: Date = new Date()): string | null {
  if (!isValidTimezone(tz)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(at);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(raw);
  if (!m || !m[1]) return "UTC";
  // Some Node/ICU builds write UTC itself as "GMT+00:00": an offset of nothing is "UTC", whichever way the runtime spells it.
  if (Number(m[2]) === 0 && (!m[3] || Number(m[3]) === 0)) return "UTC";
  const hours = String(Number(m[2]));
  return `UTC${m[1]}${hours}${m[3] && m[3] !== "00" ? `:${m[3]}` : ""}`;
}

/** What the clock says at the place right now, for the form: "Tue 22 Oct, 14:35 (UTC+4)". Null for a zone that does not exist. */
export function timezonePreview(tz: string | null | undefined, at: Date = new Date()): string | null {
  const zone = (tz ?? "").trim();
  if (!isValidTimezone(zone)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} (${utcOffsetLabel(zone, at)})`;
}

export interface LocationSuggestion { name: string; code: string; timezone: string }

/** One-click suggestions. Nothing is saved from them: they only open the form with these values filled in. */
export const LOCATION_SUGGESTIONS: readonly LocationSuggestion[] = [
  { name: "Dubai", code: "DXB", timezone: "Asia/Dubai" },
  { name: "Riyadh", code: "RUH", timezone: "Asia/Riyadh" },
  { name: "Poznan", code: "POZ", timezone: "Europe/Warsaw" },
];

/** The suggestions not already present (by name or code, ignoring case), so a place that exists is never offered twice. */
export function missingSuggestions(existing: readonly { name: string; code: string }[]): LocationSuggestion[] {
  return LOCATION_SUGGESTIONS.filter((s) => !existing.some((l) => l.code.toUpperCase() === s.code || l.name.trim().toLowerCase() === s.name.toLowerCase()));
}

export const normaliseLocationCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
export const LOCATION_CODE_RE = /^[A-Z0-9]{2,8}$/;
export const COMPANY_CODE_RE = /^[A-Z]{2,5}$/;
export const normaliseCompanyCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);

// ---------------------------------------------------------------------------------------------------------------
// Getting started checklist
// ---------------------------------------------------------------------------------------------------------------

/** What the page could read about the company's setup. `stockKnown` is false when the person cannot read stock (then stock steps say so). */
export interface SetupFacts {
  activeLocations: number;
  /** Active locations that hold at least one unit or counted quantity (registered or counted). */
  locationsWithStock: number;
  categories: number;
  activeItems: number;
  draftItems: number;
  stockKnown: boolean;
  /** Units that are registered but not counted yet, split by where they are recorded. */
  draftUnitsOnShelf: number;
  draftUnitsWithPeople: number;
  /** Units with an employee or project that were confirmed as opening custody. */
  confirmedCustodyUnits: number;
  /** Not retired units, and how many of them have at least one printed label. */
  totalUnits: number;
  labelledUnits: number;
  confirmedOpeningCounts: number;
  openCounts: number;
}

export type StepState = "done" | "partial" | "todo" | "unknown";
export interface ChecklistStep {
  id: 1 | 2 | 3 | 4 | 5;
  title: string;
  state: StepState;
  detail: string;
  href: string;
}
export interface Checklist { steps: ChecklistStep[]; doneCount: number; total: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The five stock-taking steps and which are done. A step is "done" only when the data proves it; where the person cannot read the
 * data it is "unknown" (never guessed as done or not done). "Nothing to record" for step 3 cannot be proven, so it stays open and says it may be skipped.
 */
export function computeChecklist(f: SetupFacts): Checklist {
  const s1: ChecklistStep = (() => {
    const done = f.categories > 0 && f.activeItems > 0;
    const detail = done
      ? `${plural(f.categories, "category", "categories")} and ${plural(f.activeItems, "active item")}${f.draftItems > 0 ? `; ${plural(f.draftItems, "item")} still in draft` : ""}.`
      : f.categories === 0 && f.activeItems === 0 ? "No categories or items yet."
      : f.categories === 0 ? "Add at least one category." : "Add at least one item and make it active.";
    return { id: 1, title: "Add categories, items and specifications", state: done ? "done" : f.categories > 0 || f.activeItems > 0 || f.draftItems > 0 ? "partial" : "todo", detail, href: "#categories" };
  })();

  const s2: ChecklistStep = (() => {
    if (!f.stockKnown) return { id: 2, title: "Add units or counted quantities at each location", state: "unknown", detail: "You do not have stock access, so progress here cannot be shown.", href: "#counts" };
    if (f.activeLocations === 0) return { id: 2, title: "Add units or counted quantities at each location", state: "todo", detail: "Add a location first.", href: "#locations" };
    const done = f.locationsWithStock >= f.activeLocations;
    return {
      id: 2, title: "Add units or counted quantities at each location",
      state: done ? "done" : f.locationsWithStock > 0 ? "partial" : "todo",
      detail: `${f.locationsWithStock} of ${plural(f.activeLocations, "location")} ${f.locationsWithStock === 1 ? "has" : "have"} stock recorded.`,
      href: "#counts",
    };
  })();

  const s3: ChecklistStep = (() => {
    if (!f.stockKnown) return { id: 3, title: "Record equipment already with employees or on projects", state: "unknown", detail: "You do not have stock access, so progress here cannot be shown.", href: "#custody" };
    if (f.draftUnitsWithPeople > 0) return { id: 3, title: "Record equipment already with employees or on projects", state: "partial", detail: `${plural(f.draftUnitsWithPeople, "unit")} waiting to be confirmed.`, href: "#custody" };
    if (f.confirmedCustodyUnits > 0) return { id: 3, title: "Record equipment already with employees or on projects", state: "done", detail: `${plural(f.confirmedCustodyUnits, "unit")} confirmed with employees or on projects.`, href: "#custody" };
    return { id: 3, title: "Record equipment already with employees or on projects", state: "todo", detail: "Nothing recorded yet. If no equipment is out today, you can skip this step.", href: "#custody" };
  })();

  const s4: ChecklistStep = (() => {
    if (!f.stockKnown) return { id: 4, title: "Print labels", state: "unknown", detail: "You do not have stock access, so progress here cannot be shown.", href: "/inventory/labels" };
    if (f.totalUnits === 0) return { id: 4, title: "Print labels", state: "todo", detail: "No units to label yet.", href: "/inventory/labels" };
    const missing = f.totalUnits - f.labelledUnits;
    return {
      id: 4, title: "Print labels", state: missing <= 0 ? "done" : f.labelledUnits > 0 ? "partial" : "todo",
      detail: missing <= 0 ? "Every unit has a printed label." : `${plural(missing, "unit")} without a printed label.`, href: "/inventory/labels",
    };
  })();

  const s5: ChecklistStep = (() => {
    if (!f.stockKnown) return { id: 5, title: "Review and confirm opening stock", state: "unknown", detail: "You do not have stock access, so progress here cannot be shown.", href: "#counts" };
    const waiting = f.draftUnitsOnShelf + f.draftUnitsWithPeople;
    if (f.openCounts > 0) return { id: 5, title: "Review and confirm opening stock", state: "partial", detail: `${plural(f.openCounts, "count")} open, not confirmed yet.`, href: "#counts" };
    if (f.confirmedOpeningCounts > 0 && waiting === 0) return { id: 5, title: "Review and confirm opening stock", state: "done", detail: `${plural(f.confirmedOpeningCounts, "opening count")} confirmed. Nothing is waiting to be counted.`, href: "#counts" };
    if (f.confirmedOpeningCounts > 0) return { id: 5, title: "Review and confirm opening stock", state: "partial", detail: `${plural(waiting, "unit")} still marked Not counted yet.`, href: "#counts" };
    return { id: 5, title: "Review and confirm opening stock", state: "todo", detail: "No opening count has been confirmed yet.", href: "#counts" };
  })();

  const steps = [s1, s2, s3, s4, s5];
  return { steps, doneCount: steps.filter((s) => s.state === "done").length, total: steps.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Access: who may tick what
// ---------------------------------------------------------------------------------------------------------------

/** The database refuses these from anyone who is not a founder (inv_grant_access). */
export const FOUNDER_ONLY_CAPABILITIES: readonly InvCapability[] = ["founder", "manage_access", "view_costs"];

export const isFounderOnlyCapability = (cap: InvCapability) => FOUNDER_ONLY_CAPABILITIES.includes(cap);

/** Is the checkbox for this capability disabled for the person looking at it? */
export const isCapabilityDisabled = (cap: InvCapability, viewerIsFounder: boolean) => !viewerIsFounder && isFounderOnlyCapability(cap);

export function capabilityDisabledReason(cap: InvCapability): string | null {
  switch (cap) {
    case "founder": return "Only a founder can make someone a founder.";
    case "manage_access": return "Only a founder can give the right to manage Inventory access.";
    case "view_costs": return "Only a founder can give the right to see purchase costs. It is never part of warehouse access.";
    default: return null;
  }
}

/** The capabilities to send: a non-founder can never send a founder-only right, even if the box was somehow ticked. */
export function sendableCapabilities(selected: Iterable<InvCapability>, viewerIsFounder: boolean): InvCapability[] {
  return [...new Set(selected)].filter((c) => viewerIsFounder || !isFounderOnlyCapability(c));
}

/** Can the viewer change this person's access at all? A non-founder cannot touch someone who holds a founder-only right. */
export const canChangeGrant = (holder: readonly InvCapability[], viewerIsFounder: boolean) => viewerIsFounder || !holder.some(isFounderOnlyCapability);

/** True when the only founder would lose founder rights (the database refuses it; the form says so first). */
export function wouldRemoveLastFounder(holder: readonly InvCapability[], next: readonly InvCapability[], founderCount: number): boolean {
  return holder.includes("founder") && !next.includes("founder") && founderCount <= 1;
}

/** Warehouse operators need at least one location unless they hold "all locations". */
export function operatorNeedsLocations(caps: readonly InvCapability[], locationIds: readonly string[]): boolean {
  if (caps.includes("founder") || caps.includes("cross_location")) return false;
  return caps.includes("warehouse") && locationIds.length === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------------------------------------------

export type CountKind = "opening" | "cycle";

export const COUNT_KIND_WORDS: Record<CountKind, { label: string; help: string }> = {
  opening: { label: "Opening count", help: "The first count of a place. Units and quantities become real stock, verified by the person who confirms." },
  cycle: { label: "Cycle count", help: "A later re-count. Any difference from the system is recorded as a correction with a reason." },
};

export type ParsedQty = { ok: true; value: number } | { ok: false; error: string };

/** A typed counted quantity: required (never assumed), not negative, within the item's decimal places. */
export function parseCountedQty(text: string | null | undefined, scale: number, kind: CountKind): ParsedQty {
  const raw = (text ?? "").trim().replace(",", ".");
  if (raw === "") return { ok: false, error: "Type the quantity you counted." };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, error: "The quantity must be a number, for example 12 or 36.5." };
  const value = Number(raw);
  if (!Number.isFinite(value) || value > 1_000_000_000) return { ok: false, error: "That quantity is too large." };
  const decimals = raw.includes(".") ? raw.split(".")[1]!.length : 0;
  if (decimals > scale) return { ok: false, error: scale === 0 ? "This item is counted in whole numbers." : `This item can have at most ${scale} decimal ${scale === 1 ? "place" : "places"}.` };
  if (kind === "opening" && value === 0) return { ok: false, error: "An opening count needs a quantity above zero. Leave the item out if there is none." };
  return { ok: true, value };
}

export const countDifference = (expected: number | null, counted: number) => (expected === null ? counted : Math.round((counted - expected) * 1000) / 1000);

/** Cycle counts need a reason for any difference. Opening counts never do (there is nothing to compare with). */
export function reasonRequired(kind: CountKind, expected: number | null, counted: number): boolean {
  if (kind !== "cycle") return false;
  return countDifference(expected, counted) !== 0;
}

export interface SheetLine { counted: number; expected: number | null; reason: string | null }

/** Lines that still need a reason before the count can be confirmed. */
export function linesMissingReason(kind: CountKind, lines: readonly SheetLine[]): number {
  return lines.filter((l) => reasonRequired(kind, l.expected, l.counted) && !(l.reason ?? "").trim()).length;
}

export function canConfirmCount(kind: CountKind, status: string, lines: readonly SheetLine[]): { ok: boolean; why: string | null } {
  if (status !== "open") return { ok: false, why: `This count is already ${status}.` };
  if (lines.length === 0) return { ok: false, why: "Add at least one counted line first." };
  const missing = linesMissingReason(kind, lines);
  if (missing > 0) return { ok: false, why: `${plural(missing, "line")} ${missing === 1 ? "differs" : "differ"} from the system and still ${missing === 1 ? "needs" : "need"} a reason.` };
  return { ok: true, why: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Legacy asset import: skip reasons in words
// ---------------------------------------------------------------------------------------------------------------
export const LEGACY_SKIP_WORDS: Record<string, string> = {
  duplicate_in_request: "Listed twice in this import.",
  asset_not_found: "The asset no longer exists in the HR register.",
  already_linked: "Already imported as an Inventory unit.",
  retired_asset: "Retired in the HR register, so it is not imported.",
  item_not_usable: "The chosen item is retired, belongs to another company or is not an individually tracked item.",
  location_not_usable: "The chosen location is switched off or belongs to another company.",
};
export const legacySkipWords = (reason: string | null | undefined) => (reason ? (LEGACY_SKIP_WORDS[reason] ?? reason) : "");

export interface LegacyChoice { included: boolean; itemId: string; locationId: string }
/** Rows ready to import: ticked, with both an item and a location chosen. Nothing is guessed for a row that is missing one. */
export function legacyRowsToImport(choices: Record<string, LegacyChoice | undefined>): { asset_id: string; item_id: string; location_id: string }[] {
  return Object.entries(choices).flatMap(([assetId, c]) => (c && c.included && c.itemId && c.locationId ? [{ asset_id: assetId, item_id: c.itemId, location_id: c.locationId }] : []));
}
export const legacyRowsIncomplete = (choices: Record<string, LegacyChoice | undefined>): number =>
  Object.values(choices).filter((c) => c && c.included && (!c.itemId || !c.locationId)).length;

// ---------------------------------------------------------------------------------------------------------------
// Categories (a tree the company edits; nothing is hard-coded)
// ---------------------------------------------------------------------------------------------------------------
export interface CategoryNode { id: string; name: string; parentId: string | null; sortOrder: number; isActive: boolean }
export interface CategoryRowView extends CategoryNode { depth: number; path: string }

/** The tree as an ordered flat list (parents before children; siblings by order then name). A category whose parent is missing is shown at the top. */
export function categoryRows(categories: readonly CategoryNode[]): CategoryRowView[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, CategoryNode[]>();
  for (const c of categories) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    children.set(key, [...(children.get(key) ?? []), c]);
  }
  const byOrder = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const out: CategoryRowView[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, trail: string[]) => {
    for (const c of [...(children.get(parent) ?? [])].sort(byOrder)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ ...c, depth, path: [...trail, c.name].join(" › ") });
      walk(c.id, depth + 1, [...trail, c.name]);
    }
  };
  walk(null, 0, []);
  // Bad data (a loop) must never hide a category: whatever was not reached is listed at the top level.
  for (const c of [...categories].sort(byOrder)) if (!seen.has(c.id)) { seen.add(c.id); out.push({ ...c, depth: 0, path: c.name }); }
  return out;
}

/** Every category below `id` (so the parent picker never offers a category under itself). */
export function descendantIds(categories: readonly CategoryNode[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const c of categories) if (c.parentId === current && !out.has(c.id)) { out.add(c.id); stack.push(c.id); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Count sheet: what the system expects for a counted quantity line
// ---------------------------------------------------------------------------------------------------------------
export interface ShelfBalance { itemId: string; binId: string | null; condition: string; qty: number }

/** The quantity the system holds for this item, bin and condition at the counted location (0 when there is no row yet). */
export function expectedFor(balances: readonly ShelfBalance[], itemId: string, binId: string | null, condition: string): number {
  return balances.find((b) => b.itemId === itemId && (b.binId ?? null) === (binId ?? null) && b.condition === condition)?.qty ?? 0;
}

/** True when an error means "we do not know whether it was saved" (the page then offers the result check instead of a blind retry). */
export const isUncertainMessage = (message: string | null | undefined): boolean => !!message && /did not finish in time/i.test(message);
