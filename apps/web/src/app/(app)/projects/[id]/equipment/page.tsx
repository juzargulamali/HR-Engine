import Link from "next/link";
import { notFound } from "next/navigation";
import { isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, Muted } from "@/components/projects/parts";
import { ImportHandoverButton } from "@/components/inventory/planning/import-handover";
import { RequestsQuickAdd } from "@/components/inventory/planning/requests-quick-add";
import { RequestEditor, requestCapabilities } from "@/components/inventory/planning/request-view";
import { RequestStatusBadge } from "@/components/inventory/planning/status";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId } from "@/components/workspace/url-state";
import { formatDateTime } from "@/lib/projects/format";
import { getInventoryContext } from "@/lib/inventory/context";
import { asArray, asRecord, formatInZone, num, progressFromDb, shortageLabel, str, windowLabel } from "@/lib/inventory/planning";
import { canManageProjectEquipment, loadRequestModels, loadTechnologies, loadVisibleLocations } from "@/lib/inventory/planning-data";
import { formatQty } from "@/lib/inventory/words";
import { isNotInstalled } from "@/lib/projects/errors";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Project equipment" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The equipment side of one project: what is still out, what is short, and the requirement list (requests with their lines). The
 * project manager prepares the list, expands technology templates, sets dates and destination, submits it, accepts substitutes and
 * cancels lines nobody needs. The warehouse reserves, dispatches and takes returns. Completing the project does not return equipment.
 */
export default async function ProjectEquipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const pctx = await getProjectsContext();
  if (!pctx) return null;
  const view = await loadProjectView(pctx, id);
  if (!view) notFound();
  const heading = <h2 className="text-lg font-semibold">Equipment</h2>;
  if (view.level !== "details") {
    return <div className="space-y-4">{heading}<Alert role="status">Equipment details are for the people working on this project. The Project Manager can add you if you should take part.</Alert></div>;
  }

  const inv = await getInventoryContext();
  if (!inv) return null;
  if (!inv.installed) return <div className="space-y-4">{heading}<Alert role="status">Inventory is not installed in this environment yet, so there is no equipment to show. Nothing about this project is affected.</Alert></div>;
  if (inv.loadFailed) return <div className="space-y-4">{heading}<LoadError what="the equipment of this project" retryHref={`/projects/${id}/equipment`} /></div>;

  const db = await createClient();
  const { data: raw, error } = await db.rpc("inv_project_equipment", { p_project_id: id });
  if (error) {
    if (isNotInstalled(error)) return <div className="space-y-4">{heading}<Alert role="status">Inventory is not installed in this environment yet, so there is no equipment to show.</Alert></div>;
    if ((error as { code?: string }).code === "P0002") return <div className="space-y-4">{heading}<Alert role="status">You do not have access to this project&apos;s equipment.</Alert></div>;
    console.error("[inventory] project equipment load failed", error.message);
    return <div className="space-y-4">{heading}<LoadError what="the equipment of this project" retryHref={`/projects/${id}/equipment`} /></div>;
  }
  const equipment = asRecord(raw);
  const requestsJson = asArray(equipment.requests).map(asRecord);
  const unitInfo = new Map<string, { code: string | null; serial: string | null }>();
  const dbProgress = new Map<string, unknown>();
  for (const r of requestsJson) {
    for (const l of asArray(r.lines).map(asRecord)) {
      dbProgress.set(String(l.id), l.progress);
      for (const x of asArray(l.reservations).map(asRecord)) if (str(x.unit_id)) unitInfo.set(String(x.unit_id), { code: str(x.unit_code), serial: str(x.serial_number) });
    }
  }

  let models: Awaited<ReturnType<typeof loadRequestModels>>;
  let locations: Awaited<ReturnType<typeof loadVisibleLocations>> = [];
  try {
    [models, locations] = await Promise.all([loadRequestModels({ projectId: id }, pctx.userId, { unitInfo }), loadVisibleLocations().catch(() => [])]);
  } catch (e) {
    console.error("[inventory] project requests load failed", e);
    return <div className="space-y-4">{heading}<LoadError what="the equipment requests of this project" retryHref={`/projects/${id}/equipment`} /></div>;
  }
  // The database's own progress numbers (reserved for the whole window, shortage) replace the local sums where it gave them.
  for (const m of models) for (const l of m.lines) { const p = progressFromDb(dbProgress.get(l.id), l.qty); if (p) l.progress = p; }

  const project = view.project;
  const finished = isFinishedProject(project.status);
  const manage = (await canManageProjectEquipment(id)) && !finished;
  const company = inv.companies.find((c) => c.id === project.company_id);
  const off = company ? !company.isEnabled : false;
  const warehouse = !finished && inv.grants.some((g) => g.companyId === project.company_id && (g.capabilities.includes("founder") || g.capabilities.includes("warehouse")));
  const canEditList = (manage || warehouse) && !off;
  const technologies = canEditList ? await loadTechnologies(project.company_id).catch(() => []) : [];
  const outstanding = asArray(equipment.outstanding).map(asRecord);
  // Held by the project but not named on any request (the warehouse may dispatch without naming one): still out, so listed too.
  const unlinked = asArray(equipment.unlinked).map(asRecord);
  const stillOut = outstanding.length + unlinked.length;
  // A due date is written in the local time of the request it belongs to (equipment with no request: the project's first request, or Dubai).
  const tzOfRequest = new Map(requestsJson.map((r) => [String(r.code), str(r.timezone) ?? "Asia/Dubai"] as const));
  const fallbackTz = str(requestsJson[0]?.timezone) ?? "Asia/Dubai";
  const dueBack = (iso: string | null, tz: string) => (iso ? ` · due back ${formatInZone(iso, tz)} (${tz})` : "");
  // Metres and other measured units are written with their unit, as on the request lines.
  const unitOfLine = new Map(models.flatMap((m) => m.lines.map((l) => [l.id, l.unit] as const)));
  const shortages = asArray(equipment.shortages).map(asRecord);
  const handover = models.find((m) => m.request.source === "sales_handover");
  const openRequest = parseRecordId(firstParam(sp, "request")) ?? models.find((m) => m.request.status !== "cancelled" && m.request.status !== "closed")?.request.id ?? null;

  // The import log: only people who manage the project (or read stock) can see it; it explains why nothing was imported.
  const importable = project.kind === "client" && !finished && canEditList;
  const { data: logRows } = importable ? await db.from("inv_import_log").select("outcome, detail, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(1) : { data: null };
  const lastImport = logRows?.[0] ?? null;

  const quickScope = canEditList ? {
    companies: inv.companies.map((c) => ({ id: c.id, name: c.name, canEmployee: false })),
    projects: [{ id, name: project.name, reference: project.reference, companyId: project.company_id }],
    locations: locations.filter((l) => l.company_id === project.company_id).map((l) => ({ id: l.id, name: l.name, companyId: l.company_id })),
    fixedProjectId: id,
  } : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {heading}
          <Muted className="mt-1 max-w-2xl">What this project needs from the warehouse, what has gone out and what has come back. Completing a project does not return equipment: anything still out stays outstanding until the warehouse records its return.</Muted>
        </div>
        {quickScope ? <RequestsQuickAdd scope={quickScope} label="New equipment request" /> : null}
      </div>

      {off ? <Alert variant="warning" role="status">Inventory is switched off for {company?.name ?? "this company"}. What is already recorded is shown, but nothing new can be requested until a founder switches it on.</Alert> : null}
      {finished ? <Alert role="status">This project is {project.status}. Its equipment list is read-only; unused reservations were released when it finished.</Alert> : null}

      <Panel
        title="Equipment still out"
        description="Dispatched to this project and not yet returned."
        actions={warehouse && stillOut > 0 ? <Link href={`/inventory?action=return&project=${id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Record a return</Link> : undefined}
        className={stillOut > 0 ? "border-[hsl(var(--os-amber)/0.5)]" : undefined}
      >
        {stillOut === 0 ? (
          <p className="text-sm">Nothing is out on this project right now.</p>
        ) : (
          <>
            {finished ? <Alert variant="warning" role="status" className="mb-3">The project is {project.status} but equipment is still out. Completing a project does not return it.</Alert> : null}
            <ul className="divide-y divide-border text-sm">
              {outstanding.map((o, i) => (
                <li key={`${o.line_id}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <span className="min-w-0 break-words font-medium">{str(o.item_name) ?? "Item"}{str(o.unit_code) ? <span className="font-mono font-normal text-muted-foreground"> · {str(o.unit_code)}</span> : null}{str(o.serial_number) ? <span className="font-normal text-muted-foreground"> · serial {str(o.serial_number)}</span> : null}</span>
                  <span className="text-muted-foreground">{str(o.unit_lifecycle) === "missing" ? <Badge variant="warning" className="mr-2">Recorded as missing</Badge> : null}{o.overdue === true ? <Badge variant="warning" className="mr-2">Overdue</Badge> : null}{formatQty(num(o.qty_outstanding), unitOfLine.get(String(o.line_id)))} {str(o.unit_lifecycle) === "missing" ? "not returned" : "out"} · request {str(o.request_code)}{dueBack(str(o.expected_return_at), tzOfRequest.get(String(o.request_code)) ?? fallbackTz)}</span>
                </li>
              ))}
              {unlinked.map((o, i) => (
                <li key={`unlinked-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <span className="min-w-0 break-words font-medium">{str(o.item_name) ?? "Item"}{str(o.unit_code) ? <span className="font-mono font-normal text-muted-foreground"> · {str(o.unit_code)}</span> : null}{str(o.serial_number) ? <span className="font-normal text-muted-foreground"> · serial {str(o.serial_number)}</span> : null}</span>
                  <span className="text-muted-foreground">{str(o.unit_lifecycle) === "missing" ? <Badge variant="warning" className="mr-2">Recorded as missing</Badge> : null}{o.overdue === true ? <Badge variant="warning" className="mr-2">Overdue</Badge> : null}{formatQty(num(o.qty_outstanding), str(o.unit_of_measure))} {str(o.unit_lifecycle) === "missing" ? "not returned" : "out"} · not part of a request{dueBack(str(o.expected_return_at), fallbackTz)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {shortages.length > 0 ? (
        <Panel title="Not covered yet" description="Lines the warehouse cannot cover for the request dates.">
          <ul className="divide-y divide-border text-sm">
            {shortages.map((s, i) => (
              <li key={`${s.line_id}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                <span className="min-w-0 break-words"><span className="font-medium">{str(s.item_name) ?? "Item"}</span> <span className="text-muted-foreground">· request {str(s.request_code)}</span></span>
                <span>Short by {formatQty(num(s.short_qty), unitOfLine.get(String(s.line_id)))} <span className="text-muted-foreground">· {str(s.shortage_action) && s.shortage_action !== "none" ? `${shortageLabel(str(s.shortage_action))}${str(s.rental_reference) ? ` (ref ${str(s.rental_reference)})` : ""}` : "no plan yet"}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {importable ? (
        <Panel title="Sales handover" description="When the project was created from a Sales handover, its technologies are turned into a draft equipment request.">
          <div className="space-y-2 text-sm">
            {handover ? <p>The equipment of the handover is in request <span className="font-mono">{handover.request.code}</span> below, marked <strong>Imported from the Sales handover</strong>. It is a draft until you submit it.</p> : <p>No handover request exists for this project yet.</p>}
            {lastImport ? (
              <Alert role="status" variant={lastImport.outcome === "failed" ? "destructive" : "default"}>
                Last import: {lastImport.outcome === "imported" ? "imported" : lastImport.outcome === "failed" ? "failed" : "nothing to import"} on {formatDateTime(lastImport.created_at)}.{lastImport.detail ? ` ${lastImport.detail}` : ""}
              </Alert>
            ) : null}
            <ImportHandoverButton projectId={id} label={handover ? "Run the import again" : "Import the handover equipment"} />
            <Muted>Running it again is safe: the same handover never creates a second request.</Muted>
          </div>
        </Panel>
      ) : null}

      <section aria-label="Equipment requests" className="space-y-3">
        <h3 className="text-sm font-semibold">Requests ({models.length})</h3>
        {models.length === 0 ? (
          <EmptyState title="No equipment requested for this project yet" description={canEditList ? "Start a request, then add the items or a technology template, set the dates and submit it to the warehouse." : "When the project manager or the warehouse prepares a request, it appears here."} />
        ) : (
          models.map((m) => {
            const r = m.request;
            const can = canEditList ? requestCapabilities(m, inv, locations, manage) : { edit: false, decide: false, warehouse: false, operableLocationIds: [] as string[] };
            const total = m.lines.filter((l) => l.status !== "cancelled").length;
            return (
              <details key={r.id} open={openRequest === r.id} className="rounded-lg border border-border bg-card">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="font-mono font-medium">{r.code}</span>
                  <RequestStatusBadge status={r.status} />
                  {r.source === "sales_handover" ? <Badge variant="outline">Imported from the Sales handover</Badge> : null}
                  <span className="min-w-0 break-words font-medium">{r.title ?? ""}</span>
                  <span className="text-muted-foreground">{windowLabel(r)}</span>
                  <span className="text-muted-foreground">{total === 0 ? "No lines" : `${total} ${total === 1 ? "line" : "lines"}`}{m.outstandingLines > 0 ? ` · equipment still out on ${m.outstandingLines === 1 ? "1 line" : `${m.outstandingLines} lines`}` : ""}</span>
                </summary>
                <div className="border-t border-border p-4">
                  <RequestEditor model={m} can={can} locations={locations} technologies={technologies} hideHeading />
                </div>
              </details>
            );
          })
        )}
      </section>
    </div>
  );
}
