import Link from "next/link";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OsBadge } from "@/components/os/pills";
import { Muted, Panel } from "@/components/projects/parts";
import {
  CorrectionDialog, DecideChange, DecideCorrection, DelegateForm, DeliverableDialog, LineDialog, ReconcileDialog, ReleaseDialog, RemoveDialog, SeedScopeDialog, SequenceDialog,
  type LineChoice, type Option,
} from "@/components/projects/delivery/delivery-forms";
import { MilestonePanel, PlanSummaryStrip } from "@/components/projects/delivery/plan-summary";
import { PlanTimeline } from "@/components/projects/delivery/plan-timeline";
import {
  activationReadiness, detailText, hardwareState, lateDependency, lineAttention, lineSchedule, planSummary, routeOf, timelineModel,
} from "@/lib/projects/delivery-plan/insights";
import {
  byZone, canEditSection, describeChange, DP_CURRENT_SECTIONS, DP_SECTION_LABELS, DP_SECTIONS, itemProgress, lineProgress, releasePreview, sectionFamily, SUPPLY_ROUTE_LABELS,
  type DeliveryPlan, type DpItem, type DpLine, type DpSection,
} from "@/lib/projects/delivery-plan/model";
import { dateText, formatDateTime, todayIso } from "@/lib/projects/format";

export interface DeliveryPlanViewProps {
  projectId: string; plan: DeliveryPlan; userId: string;
  /** The project is completed or archived: everything is read-only. */
  readOnly: boolean; statusWord: string;
  members: Option[]; stock: Option[]; stockFailed: boolean; images: Option[]; imagesFailed: boolean;
  nameOfUser: (id: string) => string;
  /** Breakdown (the working view, the default) or Timeline. Both draw the same plan records. */
  view?: "breakdown" | "timeline";
  /** The activation to open (its key, D001), from a link in the summary or the Timeline. */
  openKey?: string | null;
  /** Today as YYYY-MM-DD; the page passes it so the same day is used throughout. */
  today?: string;
}

const SECTION_ORDER: DpSection[] = ["hardware", "content", "apps", "engineering", "site", "programming", "installation", "testing"];
const WORK_SECTIONS: DpSection[] = ["content", "apps", "engineering", "site"];

/**
 * The Project Plan as drawn: technologies / activations (grouped by zone when the project has zones), what each needs, the next-step summary, milestones, and the
 * Breakdown / Timeline views of the same records. It receives the plan already read for this person; which controls it draws follows `plan.can_manage` and
 * `plan.my_sections`, and the database decides again on every action.
 */
export function DeliveryPlanView({ projectId: id, plan, userId, readOnly, statusWord, members, stock, stockFailed, images, imagesFailed, nameOfUser, view = "breakdown", openKey = null, today = todayIso() }: DeliveryPlanViewProps) {
  const manage = plan.can_manage && !readOnly;
  const editable = (s: DpSection) => !readOnly && canEditSection(plan, s);
  const mySections = DP_CURRENT_SECTIONS.filter(editable);
  const stockName = new Map(stock.map((s) => [s.id, s.name]));
  const imageName = new Map(images.map((f) => [f.id, f.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const milestones = plan.milestones ?? [];
  const milestoneOptions: Option[] = milestones.filter((m) => !["accepted", "deferred"].includes(m.status)).map((m) => ({ id: m.id, name: m.title }));
  const milestoneName = new Map(milestones.map((m) => [m.id, m.title]));
  const nameOf = (field: string, value: string) =>
    field === "owner_id" || field === "assignee_id" ? (memberName.get(value) ?? nameOfUser(value)) : field === "inv_item_id" ? (stockName.get(value) ?? "a stock item")
      : field === "needed_by" || field === "start_date" ? dateText(value) : field === "milestone_id" ? (milestoneName.get(value) ?? "a milestone") : value;
  const allLines = plan.items.flatMap((i) => i.lines.map((l) => ({ i, l })));
  const itemOf = new Map(plan.items.map((i) => [i.id, i]));
  const lineOf = new Map(allLines.map((x) => [x.l.id, x]));
  const proposed = plan.changes.filter((c) => c.status === "proposed");
  const decidedChanges = plan.changes.filter((c) => c.status !== "proposed").slice(0, 10);
  const openCorrections = plan.corrections.filter((c) => c.status === "open");
  const decidedCorrections = plan.corrections.filter((c) => c.status !== "open").slice(0, 10);
  const drafts = allLines.filter((x) => !x.l.released_at).length;
  const preview = releasePreview(plan.items);
  const summary = planSummary(plan, today);
  const releaseHint = preview.tasks + preview.equipment > 0 ? `Release the plan: ${preview.tasks} task${preview.tasks === 1 ? "" : "s"} and ${preview.equipment} equipment line${preview.equipment === 1 ? "" : "s"} are ready.` : null;
  const changeTarget = (c: { item_id: string | null; line_id: string | null }) => {
    if (c.item_id) { const i = itemOf.get(c.item_id); return i ? `${i.key} ${i.title}` : "An activation"; }
    const x = c.line_id ? lineOf.get(c.line_id) : undefined;
    return x ? `${x.l.key} ${x.i.title}: ${x.l.description}` : "A requirement";
  };
  const base = `/projects/${id}`;
  const scope = plan.scope;
  const pendingNames = (scope?.pending ?? []).map((t) => String(t.name ?? "")).filter(Boolean);
  const briefOnly = !!scope?.brief && (scope.technologies ?? []).length === 0;
  const others = (self: string): LineChoice[] => allLines.filter((x) => x.l.id !== self && x.l.section !== "hardware").map((x) => ({ id: x.l.id, label: `${x.l.key} ${x.i.title}: ${x.l.description}` }));
  const zones = byZone(plan.items);
  const showZones = zones.length > 1 || (zones[0] !== undefined && zones[0].zone !== "No zone");

  const lineRow = (item: DpItem, l: DpLine) => {
    const p = lineProgress(l);
    const hs = hardwareState(l);
    const sched = lineSchedule(item, l);
    const att = lineAttention(item, l, today).filter((a) => a.kind === "blocker" || a.kind === "late_dependency" || a.kind === "overdue" || a.kind === "no_owner" || a.kind === "task_pending");
    const late = lateDependency(item, l);
    const booked = l.section === "hardware" && !!l.equipment && !l.equipment.missing && !!l.equipment.request_status && l.equipment.request_status !== "draft";
    const route = routeOf(l);
    const detail = detailText(l);
    const target = l.section === "hardware" ? (route === "inventory" ? (l.inv_item_id ? (l.inv_item_name ?? stockName.get(l.inv_item_id) ?? "Stock item chosen (its name could not be read)") : "Not matched to stock") : (sched.owner ?? "No owner yet")) : (sched.owner ? `${sched.owner}${sched.ownerInherited ? " (accountable owner)" : ""}` : "Nobody named yet");
    const when = l.section === "hardware" ? (sched.due ? `needed by ${dateText(sched.due)}` : "no date recorded") : sched.start || sched.due ? `${sched.start ? `starts ${dateText(sched.start)}` : "no start date"} · ${sched.due ? `due ${dateText(sched.due)}` : "no due date"}` : "not scheduled yet";
    const draftRequest = l.equipment?.request_id && l.equipment.request_status === "draft";
    return (
      <li key={l.id} id={`dp-${l.key}`} className="flex scroll-mt-24 flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-2.5" data-testid={`dp-line-${l.key}`}>
        <div className="min-w-0 flex-1 basis-72">
          <p className="break-words text-sm"><span className="font-mono text-[12px] text-muted-foreground">{l.key}</span> <span className="font-medium">{l.description}</span>{l.qty !== null ? <span className="text-muted-foreground"> × {l.qty}</span> : null}</p>
          {detail ? <p className="break-words text-[13px]">{detail}</p> : null}
          <p className="break-words text-[13px] text-muted-foreground">
            {target} · {when}{l.milestone_id && milestoneName.get(l.milestone_id) ? ` · for ${milestoneName.get(l.milestone_id)}` : ""}{l.notes ? ` · ${l.notes}` : ""}
          </p>
          {att.length > 0 ? (
            <ul className="mt-0.5 space-y-0.5" data-testid={`dp-attention-${l.key}`}>
              {att.map((a, n) => <li key={`${a.kind}-${n}`} className="break-words text-[13px] font-medium text-[hsl(var(--os-red))]">{a.kind === "blocker" ? a.text.replace(/^.*? is blocked: /, "Blocked: ") : a.kind === "late_dependency" ? `Late: ${late}` : a.kind === "no_owner" ? "No owner: name who does this" : a.kind === "overdue" ? `Overdue: ${a.text.replace(/^.* was due /, "was due ")}` : `Task update pending: ${l.task_pending?.reason ?? "the task could not take it"}`}</li>)}
            </ul>
          ) : null}
          {l.task_pending ? (
            <p className="mt-0.5 text-[13px]" data-testid={`dp-pending-${l.key}`}>
              <span className="text-muted-foreground">The plan says {Object.entries(l.task_pending.fields).map(([k, v]) => `${k === "assignee_id" ? "owner" : k === "due_date" ? "due date" : k === "start_date" ? "start date" : "milestone"} ${v === null || v === undefined ? "cleared" : nameOf(k === "assignee_id" ? "assignee_id" : k === "milestone_id" ? "milestone_id" : "needed_by", String(v))}`).join(", ")}; the task still has {l.task?.assignee_name ?? "its owner"}{l.task?.start_date ? `, start ${dateText(l.task.start_date)}` : ""}{l.task?.due_date ? `, due ${dateText(l.task.due_date)}` : ""}{l.task?.milestone_id && milestoneName.get(l.task.milestone_id) ? `, milestone ${milestoneName.get(l.task.milestone_id)}` : ""}. </span>
              {manage ? <ReconcileDialog projectId={id} lineId={l.id} reason={l.task_pending.reason} /> : <span className="text-muted-foreground">The Project Manager can resolve it.</span>}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {route ? <OsBadge tone="quiet" className="whitespace-nowrap">{SUPPLY_ROUTE_LABELS[route]}</OsBadge> : null}
          <OsBadge tone={hs ? hs.tone : p.tone} className="whitespace-normal! text-left">{hs ? hs.text : p.text}</OsBadge>
          {l.task ? <Link href={`${base}/work?task=${l.task.id}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open task</Link> : null}
          {l.equipment?.request_id ? <Link href={`${base}/equipment?request=${l.equipment.request_id}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">{draftRequest ? "Review and send to Warehouse" : "Open equipment request"}</Link> : null}
          {editable(l.section) ? (
            <LineDialog projectId={id} itemId={item.id} sections={[l.section]} members={members} stock={stock} stockFailed={stockFailed} milestones={milestoneOptions} others={others(l.id)}
              line={{ id: l.id, version: l.version, section: l.section, description: l.description, qty: l.qty, inv_item_id: l.inv_item_id, assignee_id: l.assignee_id, needed_by: l.needed_by, notes: l.notes, released: !!l.released_at, booked,
                start_date: l.start_date ?? null, supply_route: l.supply_route ?? null, detail: l.detail, milestone_id: l.milestone_id ?? null, depends_on: (l.plan_depends_on ?? []).map((d) => d.line_id) }} />
          ) : null}
          {editable(l.section) && !l.released_at ? <RemoveDialog projectId={id} kind="line" id={l.id} name={l.description} /> : null}
          {!readOnly ? <CorrectionDialog projectId={id} targetType="line" targetId={l.id} about={`${l.key} ${l.description}`} label="Correction" /> : null}
        </div>
      </li>
    );
  };

  const activation = (item: DpItem) => {
    const prog = itemProgress(item);
    const ready = activationReadiness(item, today);
    const sections = SECTION_ORDER.filter((s) => item.lines.some((l) => l.section === s));
    const itemPreview = releasePreview([item]);
    const waitingFor = plan.delegations.filter((d) => !item.lines.some((l) => sectionFamily(l.section) === sectionFamily(d.section)) && (DP_CURRENT_SECTIONS as readonly string[]).includes(sectionFamily(d.section)));
    const seqSection = WORK_SECTIONS.find(editable);
    const open = openKey === item.key || plan.items.length <= 2;
    return (
      <details key={item.id} id={`dp-${item.key}`} open={open} className="os-card group scroll-mt-24" data-testid={`dp-activation-${item.key}`}>
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1 basis-72">
            <p className="break-words text-sm font-semibold"><span className="font-mono text-[12px] font-normal text-muted-foreground">{item.key}</span> · {item.title}{item.qty ? <span className="font-normal text-muted-foreground"> × {item.qty}</span> : null}</p>
            <p className="break-words text-[13px] text-muted-foreground">
              Accountable owner: {item.owner_name ?? "not chosen yet"} · ready by {item.needed_by ? dateText(item.needed_by) : "no date recorded"} · {prog.text}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <OsBadge tone={ready.tone === "quiet" ? "quiet" : ready.tone} className="whitespace-normal! text-left">{ready.text}</OsBadge>
            <OsBadge tone={item.released_at ? "green" : "quiet"}>{item.released_at ? "Released" : "Draft"}</OsBadge>
            <span className="text-[13px] font-medium text-accent group-open:hidden">Open</span>
            <span className="hidden text-[13px] font-medium text-accent group-open:inline">Close</span>
          </div>
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {manage ? <DeliverableDialog projectId={id} members={members} images={images} item={{ id: item.id, version: item.version, zone: item.zone, title: item.title, specs: item.specs, qty: item.qty ?? null, owner_id: item.owner_id, needed_by: item.needed_by, image_file_id: item.image_file_id, released: !!item.released_at }} /> : null}
            {manage && !item.released_at && item.lines.every((l) => !l.released_at) ? <RemoveDialog projectId={id} kind="deliverable" id={item.id} name={item.title} /> : null}
            {manage && item.lines.some((l) => !l.released_at) ? <ReleaseDialog projectId={id} itemId={item.id} label="Release" preview={itemPreview} /> : null}
            {mySections.length > 0 ? <LineDialog projectId={id} itemId={item.id} sections={mySections} members={members} stock={stock} stockFailed={stockFailed} milestones={milestoneOptions} others={others("")} /> : null}
            {seqSection ? <SequenceDialog projectId={id} itemId={item.id} section={seqSection} members={members} milestones={milestoneOptions} activationOwner={item.owner_name} /> : null}
            {!readOnly ? <CorrectionDialog projectId={id} targetType="deliverable" targetId={item.id} about={`${item.key} ${item.title}`} label="Correction" /> : null}
          </div>
          {item.specs ? <p className="whitespace-pre-wrap break-words text-sm">{item.specs}</p> : null}
          {item.image_file_id ? <p className="text-sm">Reference image: <Link href={`${base}/documents`} className="font-medium underline underline-offset-2">{imageName.get(item.image_file_id) ?? "a project file"}</Link> <span className="text-muted-foreground">(in Files &amp; client plan)</span></p> : null}
          {waitingFor.length > 0 ? (
            <p className="text-sm" data-testid={`dp-waiting-${item.key}`}>
              {waitingFor.map((d) => <OsBadge key={d.section} tone="amber" className="mr-1.5">Waiting for {d.name}: {DP_SECTION_LABELS[sectionFamily(d.section)]}</OsBadge>)}
            </p>
          ) : null}
          {sections.length === 0 ? <Muted>No requirements yet. Add only the sections this {item.title} needs: a simple job may be hardware and site work alone.</Muted> : sections.map((s) => (
            <div key={s}>
              <h4 className="text-[13px] font-semibold text-muted-foreground">{DP_SECTION_LABELS[s]}{plan.delegations.find((d) => sectionFamily(d.section) === sectionFamily(s)) ? <span className="font-normal"> · defined by {plan.delegations.find((d) => sectionFamily(d.section) === sectionFamily(s))!.name}</span> : null}</h4>
              <ul className="divide-y divide-border/70">{item.lines.filter((l) => l.section === s).map((l) => lineRow(item, l))}</ul>
            </div>
          ))}
        </div>
      </details>
    );
  };

  const viewLink = (v: "breakdown" | "timeline", label: string) => (
    <Link href={v === "breakdown" ? `${base}/delivery` : `${base}/delivery?view=timeline`} aria-current={view === v ? "page" : undefined} data-testid={`dp-view-${v}`}
      className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium ${view === v ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Project Plan</h2>
          <p className="text-sm text-muted-foreground">Break each technology into what it needs, assign and schedule it, then release it. Entered once: Release creates the tasks and adds stock-matched hardware to the draft equipment request. Progress comes from those tasks and from Inventory. <Link href={`${base}/work`} className="underline underline-offset-2">Open the Work overview</Link>.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/projects/${id}/delivery-plan/template`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden /> Download template</a>
          {mySections.length > 0 ? <Link href={`${base}/delivery/import`} className={buttonVariants({ variant: "outline", size: "sm" })}><Upload className="h-4 w-4" aria-hidden /> Import Excel</Link> : null}
          <a href={`/api/projects/${id}/delivery-plan/export`} className={buttonVariants({ variant: "outline", size: "sm" })}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Export Excel</a>
          {manage ? <DeliverableDialog projectId={id} members={members} images={images} /> : null}
          {manage ? <ReleaseDialog projectId={id} label={drafts > 0 ? `Release plan (${drafts} draft ${drafts === 1 ? "line" : "lines"})` : "Release plan"} preview={preview} /> : null}
        </div>
      </div>
      {readOnly ? <Muted>This project is {statusWord}. Its delivery plan is read-only.</Muted> : null}
      {imagesFailed ? <Alert variant="warning" role="status">Could not load this project&apos;s image files, so a reference image cannot be chosen or named just now.</Alert> : null}

      {manage && pendingNames.length > 0 ? (
        <section aria-label="Bring in the accepted technologies" className="os-card space-y-2 border-primary/60 bg-primary/5 px-4 py-3 sm:px-5" data-testid="dp-scope-pending">
          <h3 className="text-base font-semibold">Next step: bring in the accepted technologies</h3>
          <p className="text-sm">The accepted handover lists {pendingNames.length} technolog{pendingNames.length === 1 ? "y" : "ies"} that {pendingNames.length === 1 ? "is" : "are"} not in the plan yet: {(scope?.pending ?? []).map((t) => `${t.name}${t.qty ? ` × ${t.qty}` : ""}`).join(", ")}.</p>
          <p className="text-[13px] text-muted-foreground">This is a manual step: accepting a handover does not add anything to the plan by itself. Pressing the button adds one row per technology with its quantity; doing it again never duplicates a row or overwrites what you have edited, and a row you remove stays removed.</p>
          <SeedScopeDialog projectId={id} names={pendingNames} />
        </section>
      ) : null}

      <PlanSummaryStrip projectId={id} summary={summary} manage={manage} releaseHint={releaseHint} />

      <div className={briefOnly ? "grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : "space-y-5"}>
        <div className="min-w-0 space-y-5">
          <nav aria-label="Plan views" className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border p-1">{viewLink("breakdown", "Breakdown")}{viewLink("timeline", "Timeline")}</nav>

          {proposed.length > 0 ? (
            <Panel title={`Proposed changes to released work (${proposed.length})`} description="Nothing that was released changes until the Project Manager approves it. An approved owner, date or milestone change is applied to the task through the existing task rules; if the task cannot take it, the requirement shows Task update pending. Booked equipment is changed on the Equipment tab.">
              <ul className="divide-y divide-border" data-testid="dp-proposed">
                {proposed.map((c) => (
                  <li key={c.id} className="space-y-2 py-3">
                    <p className="break-words text-sm font-medium">{changeTarget(c)}</p>
                    <ul className="list-disc pl-5 text-sm">{describeChange(c, nameOf).map((t) => <li key={t} className="break-words">{t}</li>)}</ul>
                    <p className="text-[13px] text-muted-foreground">Proposed by {c.proposed_by_name} · {formatDateTime(c.proposed_at)}{c.source === "excel" ? " · from an Excel import" : ""}{c.reason ? ` · Reason: ${c.reason}` : ""}</p>
                    {manage ? <DecideChange projectId={id} changeId={c.id} canDecide /> : c.proposed_by === userId && !readOnly ? <DecideChange projectId={id} changeId={c.id} canDecide={false} /> : <Muted>Waiting for the Project Manager&apos;s decision.</Muted>}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {openCorrections.length > 0 ? (
            <Panel title={`Corrections waiting for a decision (${openCorrections.length})`} description="Raised by people on the project. Each goes to one lead; the Project Manager is told. A correction changes nothing by itself.">
              <ul className="divide-y divide-border" data-testid="dp-corrections">
                {openCorrections.map((c) => (
                  <li key={c.id} className="space-y-2 py-3">
                    <p className="break-words text-sm font-medium">{c.target_label}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    <p className="text-[13px] text-muted-foreground">Raised by {c.raised_by_name} · {formatDateTime(c.raised_at)} · sent to {c.routed_to_name ?? "the Project Manager"}</p>
                    {!readOnly && (plan.can_manage || c.routed_to === userId) ? <DecideCorrection projectId={id} correctionId={c.id} /> : <Muted>Waiting for {c.routed_to_name ?? "the Project Manager"}.</Muted>}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {milestones.length > 0 ? <MilestonePanel projectId={id} milestones={milestones} /> : null}

          {view === "timeline" ? (
            <PlanTimeline projectId={id} model={timelineModel(plan, today)} today={today} />
          ) : plan.items.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="No technologies or activations yet"
              description={manage ? "Add the first technology or activation, bring in what the handover accepted, or download the template, fill it in Excel and import it. A simple job needs only a few rows." : "The Project Manager builds the plan. You will see the whole plan here."} />
          ) : zones.map((g) => (
            <section key={g.zone} aria-label={showZones ? `Zone ${g.zone}` : "Technologies and activations"} className="space-y-3">
              {showZones ? <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.zone} <span className="font-normal">({g.items.length})</span></h3> : null}
              {g.items.map(activation)}
            </section>
          ))}
        </div>

        {scope?.brief ? (
          <aside aria-label="Accepted scope" className={briefOnly ? "lg:sticky lg:top-4" : ""} data-testid="dp-brief">
            {briefOnly ? (
              <Panel title="Accepted scope (brief)" description="The handover has the scope as a brief only, with no list of technologies. Read it here while you build the plan.">
                <p className="whitespace-pre-wrap break-words text-sm">{scope.brief}</p>
              </Panel>
            ) : (
              <details className="os-card px-4 py-3"><summary className="cursor-pointer text-sm font-semibold">Accepted scope (brief)</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{scope.brief}</p></details>
            )}
          </aside>
        ) : null}
      </div>

      {manage ? (
        <Panel title="Who defines each section" description="Delegate a section to the person who should break it down: Engineering for hardware and integration, Content for assets and UI/UX, Programming for apps, the Site Lead for site work. They add and edit that section's requirements on every technology. You still resolve overlaps and release the work.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="dp-delegations">
            {DP_CURRENT_SECTIONS.map((s) => <DelegateForm key={s} projectId={id} section={s} current={plan.delegations.find((d) => d.section === s)?.user_id ?? null} members={members} />)}
            {DP_SECTIONS.filter((s) => !(DP_CURRENT_SECTIONS as readonly string[]).includes(s) && plan.delegations.some((d) => d.section === s)).map((s) => <DelegateForm key={s} projectId={id} section={s} current={plan.delegations.find((d) => d.section === s)?.user_id ?? null} members={members} />)}
          </div>
        </Panel>
      ) : plan.delegations.length > 0 ? (
        <Muted>Sections defined by: {plan.delegations.map((d) => `${DP_SECTION_LABELS[d.section]}: ${d.name}`).join(" · ")}. The Project Manager defines the rest and releases the work.</Muted>
      ) : null}

      {decidedCorrections.length + decidedChanges.length > 0 ? (
        <Panel title="Decisions" description="The latest decided corrections and proposed changes, so the person who raised one can see what was decided and why.">
          <ul className="divide-y divide-border" data-testid="dp-decisions">
            {decidedCorrections.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="break-words"><span className="font-medium">Correction {c.status}</span> · {c.target_label}</p>
                <p className="break-words text-[13px] text-muted-foreground">“{c.body}” · raised by {c.raised_by_name} · decided by {c.decided_by_name ?? "not recorded"}{c.decided_at ? `, ${formatDateTime(c.decided_at)}` : ""}{c.decision_note ? ` · ${c.decision_note}` : ""}</p>
              </li>
            ))}
            {decidedChanges.map((c) => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="break-words"><span className="font-medium">Change {c.status}</span> · {changeTarget(c)}</p>
                <p className="break-words text-[13px] text-muted-foreground">{describeChange(c, nameOf).join("; ")} · proposed by {c.proposed_by_name}{c.decided_by_name ? ` · decided by ${c.decided_by_name}${c.decided_at ? `, ${formatDateTime(c.decided_at)}` : ""}` : ""}{c.decision_note ? ` · ${c.decision_note}` : ""}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {!readOnly ? <p className="text-sm"><CorrectionDialog projectId={id} targetType="scope" about="the agreed scope" label="Raise a correction about the agreed scope" variant="outline" /> <span className="text-muted-foreground">A change to the agreed scope itself is proposed and decided under <Link href={`${base}/changes`} className="underline underline-offset-2">Feedback &amp; changes</Link>.</span></p> : null}
    </div>
  );
}
