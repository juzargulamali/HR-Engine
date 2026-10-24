import Link from "next/link";
import { canOperateLocation, hasInvCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import type { InventoryContext } from "@/lib/inventory/context";
import { isRequestEditable, windowLabel } from "@/lib/inventory/planning";
import type { RequestModel, TechnologyOption } from "@/lib/inventory/planning-data";
import type { InvLocationRow } from "@/types/inventory";
import { AddLineForm, TechnologyForm } from "./add-forms";
import { LinesEditor, type EditorCan } from "./lines-editor";
import { PlanForm } from "./plan-form";
import { RequestMoreMenu, SubmitRequest } from "./request-actions";
import { RequestStatusBadge } from "./status";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** What this person may do with the request, as the page offers it. The database makes every real decision. */
export function requestCapabilities(model: RequestModel, ctx: InventoryContext, locations: readonly InvLocationRow[], canManageProject: boolean): EditorCan {
  const r = model.request;
  const warehouse = hasInvCapability(ctx.grants, r.company_id, "warehouse");
  const accountable = r.kind === "project" ? canManageProject : r.requested_by === ctx.userId;
  return {
    edit: warehouse || accountable,
    decide: accountable,
    warehouse,
    operableLocationIds: locations.filter((l) => l.company_id === r.company_id && canOperateLocation(ctx.grants, r.company_id, l.id, ctx.assignedLocationIds)).map((l) => l.id),
  };
}

/**
 * One equipment request: header and status, the planning dates, the lines with their progress, and everything that can be done with
 * them. Used beside the Requests list (a side panel) and inside a project's Equipment page, so both behave the same.
 */
export function RequestEditor({ model, can, locations, technologies, hideHeading = false }: {
  model: RequestModel; can: EditorCan; locations: readonly InvLocationRow[]; technologies: TechnologyOption[]; hideHeading?: boolean;
}) {
  const r = model.request;
  const editable = isRequestEditable(r.status);
  const live = r.status === "submitted" || r.status === "in_progress";
  const openLines = model.lines.filter((l) => l.status === "open");
  const hasActiveReservations = model.lines.some((l) => l.reservations.some((x) => x.status === "active"));
  const pickup = locations.find((l) => l.id === r.pickup_location_id);
  const projectId = r.project_id;
  const missing = openLines.length === 0 ? "add at least one item" : !r.needed_from || !r.needed_until ? "set the planning dates (at least a start and an end)" : null;
  const done = model.lines.filter((l) => l.status !== "cancelled");
  return (
    <div className="space-y-6">
      {hideHeading ? null : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <RequestStatusBadge status={r.status} />
            <span className="font-mono text-muted-foreground">{r.code}</span>
            {r.source === "sales_handover" ? <span className="rounded-full border border-border px-2.5 py-0.5 text-[13px] font-medium">Imported from the Sales handover</span> : null}
          </div>
          {r.title ? <p className="break-words text-base font-semibold">{r.title}</p> : null}
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">For</dt><dd className="break-words font-medium">{model.forLabel}<span className="font-normal text-muted-foreground"> · {r.kind === "project" ? "project" : "employee"}</span></dd></div>
        <div><dt className="text-muted-foreground">Requested by</dt><dd>{model.requestedByName}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">Needed (local time of the request)</dt><dd>{windowLabel({ needed_from: r.needed_from, needed_until: r.needed_until, timezone: r.timezone })}</dd></div>
        {pickup ? <div><dt className="text-muted-foreground">Collected from</dt><dd>{pickup.name}</dd></div> : null}
        {r.destination ? <div><dt className="text-muted-foreground">Destination</dt><dd className="break-words">{r.destination}</dd></div> : null}
        <div><dt className="text-muted-foreground">Lines</dt><dd>{done.length === 0 ? "None yet" : `${done.filter((l) => r.status === "fulfilled" || r.status === "closed" || l.progress.dispatched >= l.qty).length} of ${done.length} fully dispatched`}</dd></div>
      </dl>
      {r.note ? <p className="whitespace-pre-line break-words rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">{r.note}</p> : null}

      {r.status === "cancelled" ? <Alert role="status">Cancelled{r.cancel_reason ? `: ${r.cancel_reason}` : ""}. Reservations that were not used were released.</Alert> : null}
      {model.outstandingLines > 0 ? (
        <Alert variant="warning" role="status">
          Equipment from this request is still out ({model.outstandingLines === 1 ? "1 line" : `${model.outstandingLines} lines`}: see Outstanding below). {r.status === "cancelled" ? "Cancelling did not bring it back. " : ""}It stays outstanding until the warehouse records its return.
        </Alert>
      ) : null}
      {model.lines.some((l) => l.progress.shortage > 0) ? <Alert variant="warning" role="status">Some lines are not covered yet for the request dates. Open the line to see what is short and what is planned (buy or rent).</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        {r.status === "draft" && can.edit ? <div className="min-w-0 flex-1"><SubmitRequest requestId={r.id} version={r.version} projectId={projectId} missing={missing} /></div> : null}
        {can.warehouse && live && r.kind === "project" && r.project_id ? <Link href={`/inventory?action=dispatch&request=${r.id}&project=${r.project_id}`} className={buttonVariants({ size: "sm" })}>Dispatch</Link> : null}
        {can.warehouse && live && r.kind === "employee" && r.employee_id ? <Link href={`/inventory?action=issue&request=${r.id}&employee=${r.employee_id}`} className={buttonVariants({ size: "sm" })}>Issue to the employee</Link> : null}
        {can.warehouse && r.kind === "employee" && r.employee_id ? <Link href={`/inventory/employees?employee=${r.employee_id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>What this employee holds</Link> : null}
        {can.edit && editable ? <RequestMoreMenu requestId={r.id} status={r.status} projectId={projectId} outstanding={model.outstandingLines} /> : null}
      </div>
      {live && !can.warehouse ? <p className="text-sm text-muted-foreground">The warehouse reserves and dispatches. You will see reserved, dispatched and returned numbers here as they happen.</p> : null}

      {r.status === "draft" ? (
        <Section title="Planning dates" description={`Each date is local time in ${r.timezone}.`}>
          <PlanForm requestId={r.id} version={r.version} status={r.status} timezone={r.timezone} plan={r.plan} projectId={projectId} editable={can.edit && editable} hasReservations={hasActiveReservations} />
        </Section>
      ) : (
        // Once the request is with the warehouse the lines are what people work with; the eight dates stay one click away.
        <details className="rounded-md border border-border" aria-label="Planning dates">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Planning dates <span className="font-normal text-muted-foreground">(local time in {r.timezone})</span></summary>
          <div className="border-t border-border p-3">
            <PlanForm requestId={r.id} version={r.version} status={r.status} timezone={r.timezone} plan={r.plan} projectId={projectId} editable={can.edit && editable} hasReservations={hasActiveReservations} />
          </div>
        </details>
      )}

      <Section title="Equipment lines">
        <LinesEditor
          request={{ id: r.id, status: r.status, kind: r.kind, projectId: projectId, timezone: r.timezone, neededFrom: r.needed_from, neededUntil: r.needed_until, pickupLocationId: r.pickup_location_id }}
          lines={model.lines}
          can={can}
          locations={locations.filter((l) => l.company_id === r.company_id).map((l) => ({ id: l.id, name: l.name }))}
        />
        {can.edit && editable ? (
          <div className="space-y-3">
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Add an item</summary>
              <div className="border-t border-border p-3"><AddLineForm requestId={r.id} companyId={r.company_id} projectId={projectId} /></div>
            </details>
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Add from a technology template</summary>
              <div className="border-t border-border p-3"><TechnologyForm requestId={r.id} technologies={technologies} projectId={projectId} /></div>
            </details>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
