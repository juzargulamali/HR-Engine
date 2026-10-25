import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
import { SidePanel } from "@/components/workspace/side-panel";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { isRequestEditable } from "@/lib/inventory/planning";
import { canManageProjectEquipment, loadRequestModels, loadTechnologies, loadVisibleLocations } from "@/lib/inventory/planning-data";
import { RequestEditor, requestCapabilities } from "./request-view";
import { RequestStatusBadge } from "./status";

/**
 * One request beside the Requests list (`?open=<id>`). It reads through the signed-in person's own session, so a request they may not
 * see is simply "not found". The same editor is used on a project's Equipment page; this only frames it in the side panel.
 */
export async function RequestSidePanel({ openId, closeHref, retryHref }: { openId: string; closeHref: string; retryHref: string }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const id = parseRecordId(openId);
  const shell = (title: string, children: React.ReactNode, subtitle?: string, fullPageHref?: string) => (
    <SidePanel title={title} subtitle={subtitle} closeHref={closeHref} fullPageHref={fullPageHref}>{children}</SidePanel>
  );
  if (!id) return shell("Request not found", <Alert role="status">That link does not point to a request.</Alert>);
  let models: Awaited<ReturnType<typeof loadRequestModels>>;
  let locations: Awaited<ReturnType<typeof loadVisibleLocations>> = [];
  try {
    [models, locations] = await Promise.all([loadRequestModels({ ids: [id] }, ctx.userId), loadVisibleLocations().catch(() => [])]);
  } catch (e) {
    console.error("[inventory] request panel load failed", e);
    return shell("Request", <LoadError what="this request" retryHref={retryHref} />);
  }
  const model = models[0];
  if (!model) return shell("Request not found", <Alert role="status">This request does not exist, or you do not have access to it.</Alert>);
  const r = model.request;
  const manage = r.kind === "project" && r.project_id ? await canManageProjectEquipment(r.project_id) : false;
  const can = requestCapabilities(model, ctx, locations, manage);
  const technologies = can.edit && isRequestEditable(r.status) ? await loadTechnologies(r.company_id).catch(() => []) : [];
  return shell(
    r.title ?? `Request ${r.code}`,
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm"><RequestStatusBadge status={r.status} /><span className="font-mono text-muted-foreground">{r.code}</span>{r.source === "sales_handover" ? <span className="rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium">Imported from the Sales handover</span> : null}</div>
      <RequestEditor model={model} can={can} locations={locations} technologies={technologies} hideHeading />
    </div>,
    `${r.code} · ${model.forLabel}`,
    r.kind === "project" && r.project_id ? `/projects/${r.project_id}/equipment?request=${r.id}` : undefined,
  );
}
