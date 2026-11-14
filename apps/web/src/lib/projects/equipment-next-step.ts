import type { ReadinessState, RequestReadiness } from "./equipment-readiness-model";

/**
 * The next step of one equipment request, in the order the work really happens: prepare and submit (Project Manager), reserve (warehouse), dispatch (warehouse), receive back
 * (warehouse records, Project Manager checks). Pure: it reads only what the request and its readiness already say; no database, no React.
 */
export const EQUIPMENT_STEPS = ["Submit", "Reserve", "Dispatch", "Return"] as const;
export type EquipmentStep = (typeof EQUIPMENT_STEPS)[number];

export interface NextStep {
  /** The step the request is at now; null when it is finished or cancelled. */
  current: EquipmentStep | null;
  /** Steps already done, in order. */
  done: EquipmentStep[];
  /** What to do next, in one sentence, naming who does it. */
  action: string;
  /** Who acts. */
  owner: "Project Manager" | "Warehouse" | "Nobody";
  /** Planning facts that block submitting (missing dates, no lines). Empty when none. */
  missing: string[];
  /** Set when something is wrong now (short stock, return overdue, a date missing). */
  warning: boolean;
}

export interface NextStepInput {
  status: string;
  neededFrom: string | null;
  neededUntil: string | null;
  openLines: number;
  readiness?: Pick<RequestReadiness, "state" | "unitsOut" | "returnOverdue" | "shortLines" | "reservedLines" | "lines"> | null;
}

export function planningGaps(i: Pick<NextStepInput, "neededFrom" | "neededUntil" | "openLines">): string[] {
  const out: string[] = [];
  if (i.openLines === 0) out.push("No items on the request yet");
  if (!i.neededFrom) out.push("No start date (when the equipment is needed)");
  if (!i.neededUntil) out.push("No end date (when it is needed until)");
  return out;
}

const STATE_STEP: Partial<Record<ReadinessState, EquipmentStep>> = {
  reserved: "Dispatch", partially_ready: "Reserve", short: "Reserve", partially_dispatched: "Dispatch", dispatched: "Return", still_out: "Return", returned: undefined,
};

export function requestNextStep(i: NextStepInput): NextStep {
  const missing = planningGaps(i);
  if (i.status === "cancelled" || i.status === "closed" || i.status === "fulfilled") {
    return { current: null, done: i.status === "cancelled" ? [] : [...EQUIPMENT_STEPS], action: i.status === "cancelled" ? "Cancelled: nothing more to do." : "Finished: equipment returned and the request closed.", owner: "Nobody", missing: [], warning: false };
  }
  if (i.status === "draft") {
    return {
      current: "Submit", done: [], missing, warning: missing.length > 0, owner: "Project Manager",
      action: missing.length > 0 ? `Set planning dates before submitting to Warehouse${missing.some((m) => m.startsWith("No items")) ? " and add at least one item" : ""}.` : "Submit to Warehouse so they can reserve the equipment.",
    };
  }
  const r = i.readiness;
  const cur = r ? (STATE_STEP[r.state] ?? (r.state === "returned" ? null : "Reserve")) : "Reserve";
  if (r?.state === "returned" || cur === null) return { current: null, done: [...EQUIPMENT_STEPS], action: "Everything dispatched has been returned.", owner: "Nobody", missing: [], warning: false };
  const idx = EQUIPMENT_STEPS.indexOf(cur ?? "Reserve");
  const done = EQUIPMENT_STEPS.slice(0, idx);
  switch (cur) {
    case "Reserve":
      return { current: "Reserve", done, missing: [], owner: "Warehouse", warning: !!r && r.shortLines > 0, action: r && r.shortLines > 0 ? "⚠ Warehouse: part of the request is short. Buy or rent it, or accept a substitute, before it can be reserved." : "Warehouse reserves the equipment for the request dates." };
    case "Dispatch":
      return { current: "Dispatch", done, missing: [], owner: "Warehouse", warning: false, action: "Warehouse dispatches the reserved equipment to the site." };
    default:
      return { current: "Return", done, missing: [], owner: "Warehouse", warning: !!r?.returnOverdue, action: r?.returnOverdue ? "⚠ Return is overdue: Warehouse records what came back, the Project Manager chases the rest." : `Warehouse records the return${r && r.unitsOut > 0 ? ` of ${r.unitsOut === 1 ? "1 unit" : `${r.unitsOut} units`} still out` : ""}.` };
  }
}

export interface ShipmentLite { id: string; label: string; plan_item_id: string | null; activity_title?: string | null }
export interface ShipmentGroup<T extends ShipmentLite> { key: string; heading: string; shipments: T[] }
/**
 * Shipments grouped under the site run they supply (the activity's run label, else its title), in the order the runs appear in the schedule. Shipments tied to no activity are
 * grouped last under "Not tied to a site run" so none is dropped.
 */
export function shipmentsByRun<T extends ShipmentLite>(shipments: readonly T[], activities: readonly { id: string; title: string; run_label: string | null }[]): ShipmentGroup<T>[] {
  const out: ShipmentGroup<T>[] = [];
  const index = new Map<string, ShipmentGroup<T>>();
  const push = (key: string, heading: string, s: T) => { let g = index.get(key); if (!g) { g = { key, heading, shipments: [] }; index.set(key, g); out.push(g); } g.shipments.push(s); };
  const byId = new Map(activities.map((a) => [a.id, a] as const));
  for (const a of activities) if (shipments.some((s) => s.plan_item_id === a.id)) index.set(`a:${a.id}`, { key: `a:${a.id}`, heading: a.run_label ? `${a.run_label} · ${a.title}` : a.title, shipments: [] }), out.push(index.get(`a:${a.id}`)!);
  for (const s of shipments) {
    const a = s.plan_item_id ? byId.get(s.plan_item_id) : undefined;
    if (a) push(`a:${a.id}`, a.title, s);
    else if (s.plan_item_id && s.activity_title) push(`t:${s.plan_item_id}`, s.activity_title, s);
    else push("none", "Not tied to a site run", s);
  }
  return out;
}
