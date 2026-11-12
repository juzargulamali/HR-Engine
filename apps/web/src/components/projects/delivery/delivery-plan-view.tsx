import Link from "next/link";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OsBadge } from "@/components/os/pills";
import { Muted, Panel } from "@/components/projects/parts";
import {
  CorrectionDialog, DecideChange, DecideCorrection, DelegateForm, DeliverableDialog, LineDialog, ReleaseDialog, RemoveDialog, type Option,
} from "@/components/projects/delivery/delivery-forms";
import {
  byZone, canEditSection, describeChange, DP_SECTION_LABELS, DP_SECTIONS, itemProgress, lineProgress, releasePreview, type DeliveryPlan, type DpItem, type DpLine, type DpSection,
} from "@/lib/projects/delivery-plan/model";
import { dateText, formatDateTime } from "@/lib/projects/format";

const TONE: Record<string, "quiet" | "blue" | "amber" | "green" | "red"> = { quiet: "quiet", blue: "blue", amber: "amber", green: "green", red: "red" };

export interface DeliveryPlanViewProps {
  projectId: string; plan: DeliveryPlan; userId: string;
  /** The project is completed or archived: everything is read-only. */
  readOnly: boolean; statusWord: string;
  members: Option[]; stock: Option[]; stockFailed: boolean; images: Option[]; imagesFailed: boolean;
  nameOfUser: (id: string) => string;
}

/**
 * The Delivery Plan as drawn: deliverables by zone with their breakdown, what waits for a decision, who defines each section, and the latest decisions. It receives the
 * plan already read for this person; which controls it draws follows `plan.can_manage` and `plan.my_sections`, and the database decides again on every action.
 */
export function DeliveryPlanView({ projectId: id, plan, userId, readOnly, statusWord, members, stock, stockFailed, images, imagesFailed, nameOfUser }: DeliveryPlanViewProps) {
  const manage = plan.can_manage && !readOnly;
  const editable = (s: DpSection) => !readOnly && canEditSection(plan, s);
  const mySections = DP_SECTIONS.filter(editable);
  const stockName = new Map(stock.map((s) => [s.id, s.name]));
  const imageName = new Map(images.map((f) => [f.id, f.name]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const nameOf = (field: string, value: string) => (field === "owner_id" || field === "assignee_id" ? (memberName.get(value) ?? nameOfUser(value)) : field === "inv_item_id" ? (stockName.get(value) ?? "a stock item") : field === "needed_by" ? dateText(value) : value);
  const heading = <h2 className="text-lg font-semibold">Delivery plan</h2>;
  const allLines = plan.items.flatMap((i) => i.lines.map((l) => ({ i, l })));
  const itemOf = new Map(plan.items.map((i) => [i.id, i]));
  const lineOf = new Map(allLines.map((x) => [x.l.id, x]));
  const proposed = plan.changes.filter((c) => c.status === "proposed");
  const decidedChanges = plan.changes.filter((c) => c.status !== "proposed").slice(0, 10);
  const openCorrections = plan.corrections.filter((c) => c.status === "open");
  const decidedCorrections = plan.corrections.filter((c) => c.status !== "open").slice(0, 10);
  const drafts = allLines.filter((x) => !x.l.released_at).length;
  const preview = releasePreview(plan.items);
  const changeTarget = (c: { item_id: string | null; line_id: string | null }) => {
    if (c.item_id) { const i = itemOf.get(c.item_id); return i ? `${i.key} ${i.title}` : "A deliverable"; }
    const x = c.line_id ? lineOf.get(c.line_id) : undefined;
    return x ? `${x.l.key} ${x.i.title}: ${x.l.description}` : "A line";
  };
  const base = `/projects/${id}`;

  const lineRow = (item: DpItem, l: DpLine) => {
    const p = lineProgress(l);
    const booked = l.section === "hardware" && !!l.equipment && !l.equipment.missing && !!l.equipment.request_status && l.equipment.request_status !== "draft";
    const who = l.section === "hardware" ? (l.inv_item_id ? (stockName.get(l.inv_item_id) ?? "Stock item chosen") : "Stock item not chosen yet") : (l.assignee_name ?? (item.owner_name ? `${item.owner_name} (accountable owner)` : "Nobody named yet"));
    return (
      <li key={l.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-2" data-testid={`dp-line-${l.key}`}>
        <div className="min-w-0 flex-1 basis-64">
          <p className="break-words text-sm"><span className="font-mono text-[12px] text-muted-foreground">{l.key}</span> <span className="font-medium">{l.description}</span>{l.qty !== null ? <span className="text-muted-foreground"> × {l.qty}</span> : null}</p>
          <p className="break-words text-[13px] text-muted-foreground">{who} · {l.needed_by ? `needed by ${dateText(l.needed_by)}` : item.needed_by ? `needed by ${dateText(item.needed_by)} (the deliverable's date)` : "no date recorded"}{l.notes ? ` · ${l.notes}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <OsBadge tone={TONE[p.tone]} className="whitespace-nowrap">{p.text}</OsBadge>
          {l.task ? <Link href={`${base}/work?task=${l.task.id}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open task</Link> : null}
          {l.equipment?.request_id ? <Link href={`${base}/equipment?request=${l.equipment.request_id}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open equipment request</Link> : null}
          {editable(l.section) ? (
            <LineDialog projectId={id} itemId={item.id} sections={[l.section]} members={members} stock={stock} stockFailed={stockFailed}
              line={{ id: l.id, version: l.version, section: l.section, description: l.description, qty: l.qty, inv_item_id: l.inv_item_id, assignee_id: l.assignee_id, needed_by: l.needed_by, notes: l.notes, released: !!l.released_at, booked }} />
          ) : null}
          {editable(l.section) && !l.released_at ? <RemoveDialog projectId={id} kind="line" id={l.id} name={l.description} /> : null}
          {!readOnly ? <CorrectionDialog projectId={id} targetType="line" targetId={l.id} about={`${l.key} ${l.description}`} label="Correction" /> : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {heading}
          <p className="text-sm text-muted-foreground">Deliverables by zone, with the breakdown each one needs. Entered once: Release creates the tasks and adds hardware to the draft equipment request. Progress comes from those tasks and from Inventory.</p>
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

      {proposed.length > 0 ? (
        <Panel title={`Proposed changes to released work (${proposed.length})`} description="Nothing that was released changes until the Project Manager approves it. An approved change updates the plan; the linked task stays its owner's to adjust, and booked equipment is changed on the Equipment tab.">
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

      {plan.items.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No deliverables yet"
          description={manage ? "Add the first deliverable, or download the template, fill it in Excel and import it. A simple job needs only a few rows." : "The Project Manager adds the deliverables. You will see the whole plan here."} />
      ) : byZone(plan.items).map((g) => (
        <section key={g.zone} aria-label={`Zone ${g.zone}`} className="space-y-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.zone} <span className="font-normal">({g.items.length})</span></h3>
          {g.items.map((item) => {
            const prog = itemProgress(item);
            const sections = DP_SECTIONS.filter((s) => item.lines.some((l) => l.section === s));
            const itemPreview = releasePreview([item]);
            return (
              <Panel key={item.id} id={`dp-${item.key}`} title={`${item.key} · ${item.title}`}
                description={`Accountable owner: ${item.owner_name ?? "not chosen yet"} · ${item.needed_by ? `needed by ${dateText(item.needed_by)}` : "no needed-by date recorded"} · ${prog.text}`}
                actions={<div className="flex flex-wrap items-center gap-1.5">
                  <OsBadge tone={item.released_at ? "green" : "quiet"}>{item.released_at ? "Released" : "Draft"}</OsBadge>
                  {manage ? <DeliverableDialog projectId={id} members={members} images={images} item={{ id: item.id, version: item.version, zone: item.zone, title: item.title, specs: item.specs, owner_id: item.owner_id, needed_by: item.needed_by, image_file_id: item.image_file_id, released: !!item.released_at }} /> : null}
                  {manage && !item.released_at && item.lines.every((l) => !l.released_at) ? <RemoveDialog projectId={id} kind="deliverable" id={item.id} name={item.title} /> : null}
                  {manage && item.lines.some((l) => !l.released_at) ? <ReleaseDialog projectId={id} itemId={item.id} label="Release" preview={itemPreview} /> : null}
                  {!readOnly ? <CorrectionDialog projectId={id} targetType="deliverable" targetId={item.id} about={`${item.key} ${item.title}`} label="Correction" /> : null}
                </div>}>
                <div className="space-y-3">
                  {item.specs ? <p className="whitespace-pre-wrap break-words text-sm">{item.specs}</p> : <Muted>No specifications recorded.</Muted>}
                  {item.image_file_id ? <p className="text-sm">Reference image: <Link href={`${base}/documents`} className="font-medium underline underline-offset-2">{imageName.get(item.image_file_id) ?? "a project file"}</Link> <span className="text-muted-foreground">(in Files &amp; client plan)</span></p> : null}
                  {sections.length === 0 ? <Muted>No breakdown yet. Add only the sections this deliverable needs.</Muted> : sections.map((s) => (
                    <div key={s}>
                      <h4 className="text-[13px] font-semibold text-muted-foreground">{DP_SECTION_LABELS[s]}{plan.delegations.find((d) => d.section === s) ? <span className="font-normal"> · defined by {plan.delegations.find((d) => d.section === s)!.name}</span> : null}</h4>
                      <ul className="divide-y divide-border/70">{item.lines.filter((l) => l.section === s).map((l) => lineRow(item, l))}</ul>
                    </div>
                  ))}
                  {mySections.length > 0 ? <LineDialog projectId={id} itemId={item.id} sections={mySections} members={members} stock={stock} stockFailed={stockFailed} /> : null}
                </div>
              </Panel>
            );
          })}
        </section>
      ))}

      {manage ? (
        <Panel title="Who defines each section" description="Delegate a section to the person who should break it down (Engineering for hardware, Content for assets and UI/UX, Programming for apps). They can add and edit that section's lines on every deliverable. You still resolve overlaps and release the work.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="dp-delegations">
            {DP_SECTIONS.map((s) => <DelegateForm key={s} projectId={id} section={s} current={plan.delegations.find((d) => d.section === s)?.user_id ?? null} members={members} />)}
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
