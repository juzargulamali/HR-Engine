/**
 * Pure helpers for the scan page: the pending list of scanned codes (kept only in the page, never stored) and the words used when a code
 * cannot be shown. A scan only ever NAMES a record; nothing here changes stock.
 */
import { addToPendingList, parseInventoryScan, type ParsedInventoryCode, type PendingScanLine } from "@enginious-hr/domain";

/** The one message for a code that does not exist AND for a code the person may not see: the two are never told apart. */
export const UNAVAILABLE_CODE_MESSAGE = "This code is not available to you or does not exist.";

export type PendingAction = "issue" | "return" | "transfer";
export const PENDING_ACTIONS: readonly { action: PendingAction; label: string; help: string }[] = [
  { action: "issue", label: "Issue / Dispatch", help: "Give to an employee or send to a project." },
  { action: "return", label: "Return", help: "Take back from an employee or a project." },
  { action: "transfer", label: "Transfer", help: "Move to another location." },
];

/** One click on a scanned code: adds it to the list unless it is already there (one individual unit is never listed twice). */
export function scanIntoList(list: readonly PendingScanLine[], raw: string): { list: PendingScanLine[]; added: boolean; code: string | null; problem: "empty" | "too_long" | "not_inventory" | null } {
  const parsed = parseInventoryScan(raw);
  if (!parsed.ok) return { list: [...list], added: false, code: null, problem: parsed.problem };
  const r = addToPendingList(list, parsed as ParsedInventoryCode);
  return { list: r.list, added: r.added, code: parsed.code, problem: null };
}

export const removeFromPending = (list: readonly PendingScanLine[], code: string): PendingScanLine[] => list.filter((l) => l.code !== code);

/** Where a pending list continues: the matching form with the codes in the address (read there as `codes`). */
export function pendingActionHref(action: PendingAction, list: readonly PendingScanLine[]): string {
  const codes = list.map((l) => encodeURIComponent(l.code)).join(",");
  return `/inventory?action=${action}&codes=${codes}`;
}

export function scanProblemMessage(problem: "empty" | "too_long" | "not_inventory"): string {
  if (problem === "empty") return "Type or scan a code first.";
  if (problem === "too_long") return "That is too long to be an Inventory code.";
  return "That is not an Enginious Inventory code. Codes look like UAE-E-00042 (equipment) or UAE-S-00007 (an item in a bin).";
}
