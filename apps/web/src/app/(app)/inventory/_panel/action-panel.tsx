import { canOperateAnyStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { MovementPanelBody, TransferPanelBody } from "@/components/inventory/stock/movement-panel";
import type { MovementInitial } from "@/components/inventory/stock/movement-form";
import { ScanPanelBody } from "@/components/inventory/stock/scan-panel";
import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { employeeNameFor, itemCandidate, loadFormContext, requestUnitCandidates, resolveCodes } from "@/lib/inventory/stock";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import { KIND_CONFIG, type MovementKind } from "@/lib/inventory/stock-movements";

export const PANEL_ACTIONS = ["receive", "issue", "dispatch", "return", "transfer", "check", "scan"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];
export const parseAction = (raw: string): PanelAction | null => ((PANEL_ACTIONS as readonly string[]).includes(raw) ? (raw as PanelAction) : null);

export interface ActionParams { employee: string; project: string; request: string; codes: string; transfer: string; mode: string; /** The warehouse the person is working in (prefilled when they may operate there). */ location?: string; /** A catalogue item to receive (Receive stock opened from the item itself). */ item?: string }

const TITLES: Record<PanelAction, string> = { receive: "Receive stock", issue: "Give equipment", dispatch: "Dispatch to a project", return: "Receive return", transfer: "Transfer stock", check: "Inspect", scan: "Scan a label" };

/**
 * The movement forms and the scanner in a side panel (?action=…). Deep links prefill them: `employee=`, `project=`, `request=`, `codes=`
 * (equipment IDs or bin labels, comma separated), `item=` (a catalogue item to receive) and `transfer=`. The form starts from the record that already
 * knows the most: the warehouse the person is working in, the item or unit they opened it from, the employee and what they hold, the request and what it
 * has reserved, the transfer and what is still in transit. A prefilled code only puts the item on the list: the person still reviews and
 * confirms, and counted stock still needs its quantity typed. Only offered to people who may operate stock; the database checks the location.
 */
export async function ActionSidePanel({ action, params, closeHref }: { action: PanelAction; params: ActionParams; closeHref: string }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const shell = (children: React.ReactNode, title = TITLES[action]) => <SidePanel title={title} closeHref={closeHref}>{children}</SidePanel>;
  if (action === "scan") return shell(<ScanPanelBody />);
  if (!canOperateAnyStock(ctx.grants)) {
    return shell(<Alert role="status">{TITLES[action]} is for warehouse operators and Inventory founders. You can look things up and scan labels, but you cannot change stock.</Alert>);
  }
  let context: FormContext;
  try {
    context = await loadFormContext(ctx, { projects: action === "dispatch" || action === "return", requests: action === "dispatch" || action === "issue", transfers: action === "transfer" });
  } catch (e) {
    console.error("[inventory] action panel load failed", e);
    return shell(<LoadError what="what this form needs" retryHref={`/inventory/stock?action=${action}`} />);
  }
  if (context.locations.length === 0) {
    return shell(<Alert role="status">You are not set up to work at any location, so you cannot {TITLES[action].toLowerCase()}. Ask an Inventory founder to add a location to your access.</Alert>);
  }

  const initial: MovementInitial = {};
  if (params.location && context.locations.some((l) => l.id === params.location)) initial.locationId = params.location;
  const projectId = parseRecordId(params.project);
  const employeeId = parseRecordId(params.employee);
  const requestId = parseRecordId(params.request);
  const request = requestId ? context.requests.find((r) => r.id === requestId) : undefined;
  if (request) {
    initial.requestId = request.id;
    if (request.projectId) initial.projectId = request.projectId;
  }
  if (projectId && context.projects.some((p) => p.id === projectId)) initial.projectId = projectId;
  const empId = employeeId ?? request?.employeeId ?? null;
  if (empId) {
    let name: string | null = null;
    for (const companyId of new Set(context.locations.map((l) => l.companyId))) {
      name = await employeeNameFor(ctx, companyId, empId).catch(() => null);
      if (name) break;
    }
    initial.employee = { id: empId, name: name ?? "Selected employee" };
  }
  if (action === "return") initial.returnFrom = initial.employee ? "employee" : initial.projectId ? "project" : undefined;
  const codes = params.codes.split(",").map((c) => c.trim()).filter(Boolean);
  // Receiving creates new units, so a code (an existing unit or bin) has nothing to prefill there.
  if (codes.length > 0 && action !== "receive") {
    try { initial.candidates = await resolveCodes(ctx, codes); } catch (e) { console.error("[inventory] resolve codes failed", e); }
  }
  // A return carries only what the named holder still has: a unit that has since come back, or is with someone else, is left off and said so.
  if (action === "return" && initial.candidates && initial.candidates.length > 0 && (initial.employee || initial.projectId)) {
    const held = initial.candidates.filter((c) => c.type !== "unit" || (initial.employee ? c.custody === "employee" && c.employeeId === initial.employee.id : c.custody === "project" && c.projectId === initial.projectId));
    const dropped = initial.candidates.filter((c) => !held.includes(c));
    initial.candidates = held;
    if (dropped.length > 0) initial.notice = `${dropped.map((c) => c.code ?? c.itemName).join(", ")} ${dropped.length === 1 ? "is" : "are"} no longer recorded with ${initial.employee ? initial.employee.name : "this project"}, so ${dropped.length === 1 ? "it was" : "they were"} left off the list.`;
  }
  // Receive stock opened from an item: the item is already on the list (the quantity, and owned or rented, are still asked).
  const itemId = action === "receive" ? parseRecordId(params.item ?? "") : null;
  if (itemId) {
    try { const c = await itemCandidate(itemId); if (c) initial.candidates = [c]; } catch (e) { console.error("[inventory] item prefill failed", e); }
  }
  // Give equipment opened from an employee request: the units the warehouse reserved for it are already on the list.
  if (action === "issue" && request && request.kind === "employee" && codes.length === 0) {
    try {
      const carried = await requestUnitCandidates(ctx, request.id);
      if (carried.candidates.length > 0) initial.candidates = carried.candidates;
      const said = [carried.candidates.length > 0 ? `${carried.candidates.length} reserved for ${request.code} ${carried.candidates.length === 1 ? "is" : "are"} on the list. Take off anything you are not handing over now.` : null,
        carried.counted.length > 0 ? `Add and count ${carried.counted.join(", ")} yourself: a counted quantity is never filled in for you.` : null].filter(Boolean);
      if (said.length > 0) initial.notice = said.join(" ");
    } catch (e) { console.error("[inventory] request prefill failed", e); }
  }
  const transferId = parseRecordId(params.transfer);
  if (transferId) initial.transferId = transferId;

  if (action === "transfer") return shell(<TransferPanelBody context={context} initial={initial} startWith={params.mode === "receive" || transferId ? "receive" : "send"} />);
  const kind: MovementKind = action;
  return shell(<MovementPanelBody kind={kind} context={context} initial={initial} />, KIND_CONFIG[kind].title);
}
