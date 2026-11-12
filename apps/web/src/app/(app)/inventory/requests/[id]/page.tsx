import Link from "next/link";
import { cookies } from "next/headers";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { RequestLines, requestCapabilities } from "@/components/inventory/planning/request-view";
import { ReceiveStep } from "@/components/inventory/workspace/receive-step";
import { SendStep } from "@/components/inventory/workspace/send-step";
import { WorkspaceHeader } from "@/components/inventory/workspace/workspace-header";
import { BackLink } from "@/components/workspace/list-memory";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { formatInZone, isRequestEditable } from "@/lib/inventory/planning";
import { canManageProjectEquipment, loadRequestModels, loadTechnologies, loadVisibleLocations, type RequestModel } from "@/lib/inventory/planning-data";
import { loadFormContext, loadHeld } from "@/lib/inventory/stock";
import type { Candidate, FormContext } from "@/lib/inventory/stock-candidates";
import { WAREHOUSE_COOKIE, ALL_WAREHOUSES } from "@/lib/inventory/working-location";
import { heldTotals, requestItemTotals, sendItemsOf, sentCodesOf, unitHolder, type HolderOf } from "@/lib/inventory/workspace";
import { EquipmentReviewPanel } from "@/components/projects/equipment-readiness";
import { loadEquipmentReadiness } from "@/lib/projects/equipment-readiness";
import { cn } from "@/lib/utils";

export const metadata = { title: "Project equipment" };

const STEPS = [{ id: "prepare", label: "1  Prepare" }, { id: "send", label: "2  Send out" }, { id: "back", label: "3  Receive back" }] as const;
type Step = (typeof STEPS)[number]["id"];

/**
 * One request's equipment in one place: Prepare (reserve), Send out, Receive back. These are working views of the SAME request, reservations and
 * movements the rest of Inventory already uses: no second workflow, no new status, no approval. Reserving never sends anything; sending and
 * receiving each go through the existing movement flow, and the database makes every real decision.
 */
export default async function RequestWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id: rawId } = await params;
  const sp = await searchParams;
  const id = parseRecordId(rawId);
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const back = <BackLink section="today" fallback="/inventory">Today</BackLink>;
  if (!id) return <div className="space-y-4">{back}<Alert role="status">That link does not point to a request.</Alert></div>;

  let models: RequestModel[];
  let locations: Awaited<ReturnType<typeof loadVisibleLocations>> = [];
  try {
    [models, locations] = await Promise.all([loadRequestModels({ ids: [id] }, ctx.userId), loadVisibleLocations().catch(() => [])]);
  } catch (e) {
    console.error("[inventory] request workspace load failed", e);
    return <div className="space-y-4">{back}<LoadError what="this request" retryHref={`/inventory/requests/${id}`} /></div>;
  }
  const model = models[0];
  if (!model) return <div className="space-y-4">{back}<Alert role="status">This request does not exist, or you do not have access to it.</Alert></div>;

  const r = model.request;
  let manage = false;
  try {
    manage = r.kind === "project" && r.project_id ? await canManageProjectEquipment(r.project_id) : false;
  } catch (e) {
    console.error("[inventory] project standing load failed", e);
    return <div className="space-y-4">{back}<LoadError what="this request" retryHref={`/inventory/requests/${id}`} /></div>;
  }
  const can = requestCapabilities(model, ctx, locations, manage);
  // A committed project date that changed while this request is with the warehouse: the warehouse sees it HERE, on the request, where the booking is changed.
  const reviews = r.kind === "project" && r.project_id ? await loadEquipmentReadiness(r.project_id) : ({ state: "none" } as const);
  const live = r.status === "submitted" || r.status === "in_progress";
  const project = r.kind === "project" && !!r.project_id;
  const wanted = firstParam(sp, "step");
  // Employee requests have no send/receive steps of their own (the existing Give equipment form does that); a project request opens where asked.
  const step: Step = project && (wanted === "send" || wanted === "back") ? wanted : "prepare";
  const here = (s: Step) => `/inventory/requests/${id}?step=${s}`;

  // Where the person sends from and receives into: the request's pickup warehouse, else the one they work in, else their first.
  const operable = locations.filter((l) => l.company_id === r.company_id && can.operableLocationIds.includes(l.id)).map((l) => ({ id: l.id, name: l.name }));
  const remembered = (await cookies()).get(WAREHOUSE_COOKIE)?.value ?? "";
  const defaultLocationId = [r.pickup_location_id, remembered !== ALL_WAREHOUSES ? remembered : null, ...ctx.assignedLocationIds].find((x) => !!x && operable.some((o) => o.id === x)) ?? operable[0]?.id ?? "";
  const pickupName = locations.find((l) => l.id === r.pickup_location_id)?.name ?? null;

  const tabs = project ? (
    <nav aria-label="Project equipment steps" className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-card p-1">
      {STEPS.map((s) => (
        <Link key={s.id} href={here(s.id)} scroll={false} aria-current={step === s.id ? "step" : undefined}
          className={cn("flex h-11 items-center justify-center rounded-md px-2 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", step === s.id ? "brand-gradient font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}>
          {s.label}
        </Link>
      ))}
    </nav>
  ) : null;

  let content: React.ReactNode;
  if (step === "prepare") {
    const technologies = can.edit && isRequestEditable(r.status) ? await loadTechnologies(r.company_id).catch(() => []) : [];
    content = (
      <div className="space-y-4">
        {r.status === "draft" ? <Alert variant="warning" role="status">This request has not been submitted yet, so the warehouse cannot reserve for it. <Link href={`/inventory/requests?open=${r.id}`} className="font-medium underline underline-offset-2">Open the request</Link> to finish and submit it.</Alert> : null}
        {r.status === "cancelled" ? <Alert role="status">Cancelled{r.cancel_reason ? `: ${r.cancel_reason}` : ""}. Reservations that were not used were released.</Alert> : null}
        {model.lines.some((l) => l.progress.shortage > 0) ? <Alert variant="warning" role="status">Some lines are not covered yet for the booking window. Reserve what is free; for the rest, propose a substitute from the template or note that it needs to be bought or rented.</Alert> : null}
        <RequestLines model={model} can={can} locations={locations} technologies={technologies} showProgress={false} />
        <p className="text-xs text-muted-foreground">Reserving holds equipment for the booking window. It never sends anything: that is the next step.</p>
      </div>
    );
  } else if (!project) {
    content = null;
  } else if (!can.warehouse) {
    content = <Alert role="status">The warehouse sends equipment and receives it back. You will see reserved, sent and returned numbers on this request as they happen.</Alert>;
  } else if (step === "send") {
    // The step stays mounted when the request stops being live (a dispatch that sends everything makes it "fulfilled"), so the "Recorded" panel and the note's PDF links are not torn down by the refresh.
    let formContext: FormContext | null = null;
    if (live) {
      try { formContext = await loadFormContext(ctx, { projects: true, requests: true }); } catch (e) { console.error("[inventory] workspace form context failed", e); }
    }
    const blocked = live ? undefined : `This request is ${r.status === "draft" ? "not submitted yet" : r.status}, so equipment cannot be sent against it. ${r.status !== "draft" ? "Equipment that is already out is received back in the next step." : ""}`.trim();
    content = (
      <SendStep
        requestId={r.id} requestCode={r.code} projectId={r.project_id!} projectName={model.forLabel} companyId={r.company_id}
        items={sendItemsOf(model)} sentCodes={sentCodesOf(model)} locations={operable} defaultLocationId={defaultLocationId}
        expectedReturnLabel={r.expected_return_at ? formatInZone(r.expected_return_at, r.timezone) : "the request's date"} formContext={formContext} blockedMessage={blocked}
      />
    );
  } else {
    let projectModels: RequestModel[] = [model];
    try { projectModels = await loadRequestModels({ projectId: r.project_id! }, ctx.userId); } catch (e) { console.error("[inventory] workspace project requests failed", e); }
    let held: Candidate[] = [];
    let heldError: string | null = null;
    try { held = await loadHeld(ctx, { companyId: r.company_id, projectId: r.project_id! }); } catch (e) { console.error("[inventory] workspace held failed", e); heldError = "It could not be read."; }
    const totals = requestItemTotals(model, projectModels, heldError ? null : heldTotals(held));
    const holders: Record<string, HolderOf> = {};
    for (const c of held) if (c.unitId) holders[c.unitId] = unitHolder(c.unitId, model, projectModels);
    content = (
      <ReceiveStep
        companyId={r.company_id} projectId={r.project_id!} projectName={model.forLabel} requestCode={r.code} locations={operable} defaultLocationId={defaultLocationId}
        held={held} heldError={heldError} totals={totals} holders={holders}
      />
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h1 className="text-2xl font-semibold">{r.title ?? `Request ${r.code}`}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{project ? "One place for this project's equipment: prepare it, send it out, receive it back." : "Prepare the equipment, then give it to the employee."}</p>
      </div>
      <WorkspaceHeader model={model} pickupName={pickupName} />
      {reviews.state === "ok" ? <EquipmentReviewPanel reviews={reviews.readiness.reviews.filter((v) => v.requestId === id)} projectId={r.project_id!} canReview={can.operableLocationIds.length > 0 || manage} />
        : reviews.state === "error" ? <Alert role="status">Whether a project date changed for this request could not be loaded. Reload to check before changing the booking.</Alert> : null}
      {tabs}
      {content}
      {!project && r.employee_id && can.warehouse ? (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4" aria-label="Give to the employee">
          <p className="mr-auto text-sm">When it is reserved, give it to the employee. What they already hold is under With people.</p>
          {live ? <Link href={`/inventory/stock?action=issue&request=${r.id}&employee=${r.employee_id}`} className={buttonVariants({ size: "sm" })}>Give equipment</Link> : null}
          <Link href={`/inventory/stock?view=people&employee=${r.employee_id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>What they hold</Link>
        </section>
      ) : null}
    </div>
  );
}
