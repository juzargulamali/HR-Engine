import type { InvBalanceCondition, InvCondition, InvTracking } from "@/types/inventory";
import { CONDITION_WORDS, CUSTODY_WORDS, LIFECYCLE_WORDS } from "./words";
import { emptyDraft, KIND_CONFIG, sourceFor, type AdjustAction, type LineDraft, type MovementKind } from "./stock-movements";

/**
 * Something a person can put on a movement list: one individual unit, a counted row (an item in one bin and condition), or an item
 * from the catalogue (for receiving). Pure types and mappers, shared by the server (which builds them from rows the person may read)
 * and the forms (which turn them into lines). Nothing here decides whether a movement is allowed: the database does.
 */
export interface Candidate {
  /** Stable key in the result list. */
  key: string;
  type: "unit" | "counted" | "item";
  unitId: string | null;
  /** Equipment ID (units) or bin label (counted stock in a bin). */
  code: string | null;
  serial: string | null;
  itemId: string;
  itemName: string;
  detail: string | null;
  tracking: InvTracking;
  uom: string;
  scale: number;
  /** Unit condition, or the condition of the counted row. */
  condition: string;
  lifecycle: string | null;
  custody: string | null;
  /** Quantity on the shelf or held, for counted rows. Null for units and catalogue items. */
  qty: number | null;
  binId: string | null;
  binLabel: string | null;
  locationId: string | null;
  rentalId: string | null;
  repairReference: string | null;
  inKit: boolean;
  /** Who or what holds it now (names where the person may see them). */
  employeeId: string | null;
  employeeName: string | null;
  projectId: string | null;
  projectName: string | null;
  /** "On the shelf at Dubai, bin A1", "With an employee"… */
  where: string;
}

export const candidateBase = (over: Partial<Candidate> & Pick<Candidate, "key" | "type" | "itemId" | "itemName">): Candidate => ({
  unitId: null, code: null, serial: null, detail: null, tracking: "individual", uom: "each", scale: 0, condition: "good", lifecycle: null, custody: null, qty: null,
  binId: null, binLabel: null, locationId: null, rentalId: null, repairReference: null, inKit: false, employeeId: null, employeeName: null, projectId: null,
  projectName: null, where: "", ...over,
});

export function whereText(c: Pick<Candidate, "custody" | "lifecycle" | "binLabel" | "employeeName" | "projectName" | "repairReference" | "inKit">, locationName?: string | null): string {
  if (c.lifecycle === "draft") return LIFECYCLE_WORDS.draft;
  if (c.lifecycle === "missing") return LIFECYCLE_WORDS.missing;
  if (c.lifecycle === "retired") return LIFECYCLE_WORDS.retired;
  switch (c.custody) {
    case "warehouse": return `${CUSTODY_WORDS.warehouse}${locationName ? `: ${locationName}` : ""}${c.binLabel ? `, bin ${c.binLabel}` : ""}`;
    case "employee": return `${CUSTODY_WORDS.employee}${c.employeeName ? `: ${c.employeeName}` : ""}`;
    case "project": return `${CUSTODY_WORDS.project}${c.projectName ? `: ${c.projectName}` : ""}`;
    case "transit": return CUSTODY_WORDS.transit;
    case "repair": return `${CUSTODY_WORDS.repair}${c.repairReference ? ` (${c.repairReference})` : ""}`;
    case "kit": return CUSTODY_WORDS.kit;
    default: return "";
  }
}

/** The line a candidate becomes when the person adds it. Counted lines start with NO quantity: it is always typed. */
export function draftFromCandidate(c: Candidate, kind: MovementKind, id: string): LineDraft {
  const cfg = KIND_CONFIG[kind];
  const isUnit = c.type === "unit";
  // Returns default to "good, available now"; a check or a repair-in starts from what it is now / good.
  let condition = "good";
  if (kind === "check" || kind === "receive_transfer") condition = c.condition;
  if (kind === "adjust" || kind === "transfer" || kind === "repair_out") condition = isUnit ? c.condition : (c.condition as InvBalanceCondition);
  if (kind === "unpack_kit" || kind === "pack_kit") condition = c.condition;
  return emptyDraft({
    id,
    itemId: c.itemId,
    itemName: c.itemName,
    unitId: isUnit ? c.unitId : null,
    code: c.code,
    tracking: c.tracking,
    uom: c.uom,
    scale: c.scale,
    qty: "",
    binId: cfg.lineBin && !isUnit ? (c.binId ?? "") : "",
    binLabel: !isUnit ? (c.binLabel ?? "") : "",
    condition,
    fromCondition: !isUnit && (kind === "check" || kind === "receive_transfer") ? c.condition : "",
    rentalId: c.rentalId,
    repairReference: c.repairReference ?? "",
    maxQty: c.qty,
    where: c.where,
  });
}

/**
 * Is this unit something the chosen movement can use? A plain sentence when not, null when it can. Mirrors inv_unit_block_reason so the
 * person hears it before the review step; the database still makes the real check (and its own message is shown as it is).
 */
export function unitProblemFor(kind: MovementKind, c: Candidate, adjustAction?: AdjustAction): string | null {
  if (c.type !== "unit") return null;
  const label = c.code ?? "This item";
  const source = sourceFor(kind, adjustAction);
  if (source === "held") return null;
  if (source === "repair") return c.custody === "repair" ? null : `${label} is not out for repair`;
  if (source === "missing") return c.lifecycle === "missing" ? null : `${label} is not recorded as missing`;
  if (source === "transit") return c.custody === "transit" ? null : `${label} is not in transit`;
  if (c.lifecycle === "draft") return `${label} has not been counted and confirmed yet, so it cannot be used`;
  if (c.lifecycle === "missing") return `${label} is recorded as missing`;
  if (c.lifecycle === "retired") return `${label} is retired`;
  if (c.inKit && kind !== "unpack_kit") return `${label} is packed in a kit and cannot be handled on its own`;
  if (c.custody !== "warehouse") return `${label} is not on the shelf: ${c.where.toLowerCase() || "it is elsewhere"}`;
  const needsUsable = kind === "issue" || kind === "dispatch" || kind === "pack_kit";
  if (needsUsable && c.condition !== "good" && c.condition !== "fair") return `${label} is ${(CONDITION_WORDS[c.condition as InvCondition] ?? c.condition).toLowerCase()} and is held back until it has been checked`;
  return null;
}

/** Search words typed by a person, made safe to put in a text filter. */
export function cleanSearch(q: string): string {
  return q.replace(/[%_,()*\\"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function candidateMatches(c: Candidate, q: string): boolean {
  const tokens = cleanSearch(q).toLowerCase().split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [c.itemName, c.detail, c.code, c.serial, c.binLabel, c.where].filter(Boolean).join(" ").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// ---------------------------------------------------------------------------------------------------------------
// What the movement forms are given (plain data, safe to pass from the server to the browser)
// ---------------------------------------------------------------------------------------------------------------

export interface FormLocation { id: string; companyId: string; companyName: string; name: string; timezone: string; bins: { id: string; code: string; label: string | null }[] }
export interface FormProject { id: string; companyId: string; reference: string; name: string; status: string }
export interface FormRequest { id: string; companyId: string; code: string; kind: "project" | "employee"; projectId: string | null; employeeId: string | null; title: string | null; status: string; expectedReturnAt: string | null }
export interface FormTransfer { id: string; code: string; companyId: string; fromLocationId: string; fromName: string; toLocationId: string; toName: string; expectedAt: string | null; carrier: string | null; reference: string | null; dispatchedAt: string; held: Candidate[] }
export interface FormRental { id: string; companyId: string; supplier: string; reference: string; deadline: string }

export interface FormContext {
  locations: FormLocation[];
  /** Every active location of the same companies: where a transfer can be sent. */
  destinations: FormLocation[];
  projects: FormProject[];
  requests: FormRequest[];
  transfers: FormTransfer[];
  rentals: FormRental[];
  canSeeCostsByCompany: Record<string, boolean>;
}


/** What reading a label says: a unit, a bin of counted stock, or "not found / not yours" (never an error that reveals more). */
export type ScanResolution =
  | { ok: true; kind: "unit"; unitId: string; itemId: string; code: string; candidate: Candidate }
  | { ok: true; kind: "stock"; itemId: string; code: string; candidate: Candidate }
  | { ok: false; message: string };

