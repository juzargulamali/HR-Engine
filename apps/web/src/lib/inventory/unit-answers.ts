import { CONDITION_WORDS } from "./words";
import type { InvCondition } from "@/types/inventory";

/**
 * The four questions people ask about one piece of equipment, answered from the unit's own record: Where is it now? Who has it? Is it available? What
 * should I do next? Pure (unit tested); nothing here is a permission or a rule of its own: it reads the same fields the database uses to decide whether a
 * unit can be used (`inv_unit_usable`: active, on the shelf, good or fair, not packed in a kit) and puts them in words. A unit that is damaged or held
 * for inspection is said to be NOT available, with who can clear it.
 */
export interface UnitFacts {
  lifecycle: string;
  custody: string;
  condition: string;
  inKit: boolean;
  /** "In the warehouse: Dubai · Enginious UAE, bin A1", "With an employee: Riya Rigger"… */
  where: string;
  employeeName: string | null;
  projectName: string | null;
  overdue: boolean;
}

export interface UnitAnswers {
  where: string;
  who: string;
  available: boolean;
  /** "Available", or why not: "Not available: damaged, held for inspection". */
  availability: string;
  /** What to do next, in words; null when there is nothing to do. */
  next: string | null;
  /** The action that does it (a key the panel maps to its own link), when the person may operate stock there. */
  nextAction: "give" | "inspect" | "receive_return" | "receive_transfer" | "repair_in" | "found" | null;
}

const HELD: readonly string[] = ["needs_inspection", "damaged", "unserviceable"];

export function unitAnswers(u: UnitFacts): UnitAnswers {
  const cond = (CONDITION_WORDS[u.condition as InvCondition] ?? u.condition).toLowerCase();
  const base = { where: u.where || "Not recorded" };
  if (u.lifecycle === "retired") return { ...base, who: "Nobody: it is retired", available: false, availability: "Not available: retired", next: null, nextAction: null };
  if (u.lifecycle === "missing") return { ...base, who: "Nobody: it is recorded as missing", available: false, availability: "Not available: missing", next: "If it turns up, mark it found. It is then held for inspection.", nextAction: "found" };
  if (u.lifecycle === "draft") return { ...base, who: who(u), available: false, availability: "Not available: not counted yet", next: "Confirm it in the opening stock count (Setup, Getting stock in).", nextAction: null };
  switch (u.custody) {
    case "employee": return { ...base, who: u.employeeName ?? "An employee", available: false, availability: `Not available: with ${u.employeeName ?? "an employee"}${u.overdue ? ", overdue" : ""}`, next: "Receive the return when it comes back, and record its condition.", nextAction: "receive_return" };
    case "project": return { ...base, who: u.projectName ? `Project ${u.projectName}` : "A project", available: false, availability: `Not available: on ${u.projectName ? `project ${u.projectName}` : "a project"}${u.overdue ? ", overdue" : ""}`, next: "Receive the return when it comes back, and record its condition.", nextAction: "receive_return" };
    case "transit": return { ...base, who: "Nobody: it is in transit between warehouses", available: false, availability: "Not available: in transit until the other warehouse receives it", next: "The receiving warehouse records the transfer as received.", nextAction: "receive_transfer" };
    case "repair": return { ...base, who: "The repairer", available: false, availability: "Not available: out for repair", next: "Record it back from repair when it returns.", nextAction: "repair_in" };
    case "kit": return { ...base, who: "Nobody: it is packed in a kit", available: false, availability: "Not available on its own: packed in a kit", next: "Unpack the kit to use it on its own.", nextAction: null };
    default: break;
  }
  if (u.inKit) return { ...base, who: "Nobody: it is packed in a kit", available: false, availability: "Not available on its own: packed in a kit", next: "Unpack the kit to use it on its own.", nextAction: null };
  if (HELD.includes(u.condition)) {
    return { ...base, who: "Nobody: it is in the warehouse", available: false, availability: `Not available: ${cond}, held for inspection`, next: "Inspect it. A warehouse operator at this warehouse, or a founder, records its condition; good or fair makes it available again.", nextAction: "inspect" };
  }
  return { ...base, who: "Nobody: it is in the warehouse", available: true, availability: `Available (${cond})`, next: "Give it to a person, send it with a request, or transfer it.", nextAction: "give" };
}

const who = (u: UnitFacts): string => (u.custody === "employee" ? (u.employeeName ?? "An employee") : u.custody === "project" ? (u.projectName ? `Project ${u.projectName}` : "A project") : "Nobody: it is in the warehouse");
