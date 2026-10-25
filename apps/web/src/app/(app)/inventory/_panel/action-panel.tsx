import { canOperateAnyStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { MovementPanelBody, TransferPanelBody } from "@/components/inventory/stock/movement-panel";
import type { MovementInitial } from "@/components/inventory/stock/movement-form";
import { ScanPanelBody } from "@/components/inventory/stock/scan-panel";
import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { employeeNameFor, loadFormContext, resolveCodes } from "@/lib/inventory/stock";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import { KIND_CONFIG, type MovementKind } from "@/lib/inventory/stock-movements";

export const PANEL_ACTIONS = ["receive", "issue", "dispatch", "return", "transfer", "scan"] as const;
export type PanelAction = (typeof PANEL_ACTIONS)[number];
export const parseAction = (raw: string): PanelAction | null => ((PANEL_ACTIONS as readonly string[]).includes(raw) ? (raw as PanelAction) : null);

export interface ActionParams { employee: string; project: string; request: string; codes: string; transfer: string; mode: string }

const TITLES: Record<PanelAction, string> = { receive: "Receive stock", issue: "Issue to a person", dispatch: "Dispatch to a project", return: "Return", transfer: "Transfer between locations", scan: "Scan a label" };

/**
 * The movement forms and the scanner in a side panel (?action=…). Deep links prefill them: `employee=`, `project=`, `request=`, `codes=`
 * (equipment IDs or bin labels, comma separated) and `transfer=`. A prefilled code only puts the item on the list: the person still reviews and
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
    return shell(<LoadError what="what this form needs" retryHref={`/inventory?action=${action}`} />);
  }
  if (context.locations.length === 0) {
    return shell(<Alert role="status">You are not set up to work at any location, so you cannot {TITLES[action].toLowerCase()}. Ask an Inventory founder to add a location to your access.</Alert>);
  }

  const initial: MovementInitial = {};
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
  const transferId = parseRecordId(params.transfer);
  if (transferId) initial.transferId = transferId;

  if (action === "transfer") return shell(<TransferPanelBody context={context} initial={initial} startWith={params.mode === "receive" || transferId ? "receive" : "send"} />);
  const kind: MovementKind = action;
  return shell(<MovementPanelBody kind={kind} context={context} initial={initial} />, KIND_CONFIG[kind].title);
}
