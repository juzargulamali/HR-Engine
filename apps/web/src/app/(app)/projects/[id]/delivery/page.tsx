import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import type { Option } from "@/components/projects/delivery/delivery-forms";
import { DeliveryPlanView } from "@/components/projects/delivery/delivery-plan-view";
import { LoadError } from "@/components/workspace/states";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { loadDeliveryPlan } from "@/lib/projects/delivery-plan/data";
import { canEditSection, DP_SECTIONS } from "@/lib/projects/delivery-plan/model";
import { todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { RegisterView } from "@/components/projects/deliverables/output-views";
import { loadRegister } from "@/lib/projects/phase2/data";
import { filterRegister, parseRegisterFilter, type RegisterFilter } from "@/lib/projects/phase2/model";

export const metadata = { title: "Project Plan" };

/**
 * The Project Plan of one project (the Delivery Plan, same records and same address): technologies / activations, each with the requirements that apply. Every member of the project reads all of it. Whoever manages the
 * project edits deliverable rows and releases; a section's delegate edits that section's lines; any member raises a correction. Work is entered once here: Release creates
 * the tasks and adds hardware to the DRAFT equipment request (submitting that to the warehouse stays on the Equipment tab). Progress is read from those records.
 */
export default async function DeliveryPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; open?: string; from?: string; f?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const heading = <h2 className="text-lg font-semibold">Project Plan</h2>;

  const res = await loadDeliveryPlan(id);
  if (res.state === "not_installed") return <div className="space-y-4">{heading}<Alert role="status">The Project Plan is not installed in this environment yet. Nothing else about this project is affected.</Alert></div>;
  if (res.state === "denied") return <div className="space-y-4">{heading}<Alert role="status">The Project Plan is for the people working on this project. The Project Manager can add you if you should take part.</Alert></div>;
  if (res.state === "error") return <div className="space-y-4">{heading}<LoadError what="the Project Plan" retryHref={`/projects/${id}/delivery`} /></div>;
  const plan = res.plan;
  const readOnly = isFinishedProject(view.project.status);
  const members: Option[] = memberOptions(view);
  const mySections = DP_SECTIONS.filter((s) => !readOnly && canEditSection(plan, s));

  // Stock items (for a hardware line) and image files (for a reference image) are read with the person's own session. A failed read is said on the form; it never
  // shows as "no stock" or "no images".
  const db = await createClient();
  const [stockRes, fileRes] = await Promise.all([
    mySections.includes("hardware") ? db.from("inv_items").select("id, name, status").eq("company_id", view.project.company_id).neq("status", "retired").order("name").limit(2000) : Promise.resolve({ data: [], error: null }),
    db.from("proj_files").select("id, label, original_name, mime_type").eq("project_id", id).eq("kind", "file").is("deleted_at", null).like("mime_type", "image/%").order("created_at", { ascending: false }).limit(200),
  ]);
  const stock: Option[] = (stockRes.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const images: Option[] = (fileRes.data ?? []).map((f) => ({ id: f.id, name: f.label || f.original_name || "Image" }));

  // The Deliverables view: the register from the same records as the task panel (one database read, scoped to this person).
  let deliverablesSlot: React.ReactNode = null;
  if (sp.view === "deliverables") {
    const reg = await loadRegister(id);
    const filter = parseRegisterFilter(sp.f);
    if (reg.state === "ok") {
      const { data: fb } = view.canManage && !readOnly ? await db.from("proj_feedback").select("id, source, request_text").eq("project_id", id).order("received_on", { ascending: false }).limit(50) : { data: [] };
      deliverablesSlot = (
        <RegisterView projectId={id} register={reg.data} filter={filter} userId={ctx.userId} rows={filterRegister(reg.data.rows, filter as RegisterFilter, ctx.userId)} feedback={(fb ?? []).map((f) => ({ id: f.id, name: `${f.source}: ${f.request_text.slice(0, 80)}` }))}
          activations={plan.items.map((i) => ({ id: i.id, name: `${i.key} ${i.title}` }))} hrefFor={(f) => `/projects/${id}/delivery?view=deliverables${f === "all" ? "" : `&f=${f}`}`}
          isReviewer={(r) => !readOnly && r.assignee_id !== ctx.userId && (view.canManage || (!!r.team_id && view.headOfTeamIds.includes(r.team_id)))} />
      );
    } else {
      deliverablesSlot = reg.state === "not_installed" ? <Alert role="status">Deliverables are not installed in this environment yet. The rest of the Project Plan is unaffected.</Alert>
        : reg.state === "denied" ? <Alert role="status">The deliverables register is for the people working on this project.</Alert> : <LoadError what="the deliverables register" retryHref={`/projects/${id}/delivery?view=deliverables`} />;
    }
  }

  return (
    <div className="space-y-4">
      {sp.from === "handover" ? <Alert role="status" data-testid="dp-welcome">This project was created from the accepted handover. Start here: <strong>press Bring in accepted technologies</strong> (the accepted technologies are not added automatically), then assign and schedule what each needs and release it. The <Link href={`/projects/${id}/work`} className="font-medium underline">Work overview</Link> is one click away.</Alert> : null}
    <DeliveryPlanView projectId={id} plan={plan} userId={ctx.userId} readOnly={readOnly} statusWord={view.project.status} members={members} stock={stock} stockFailed={!!stockRes.error}
      images={images} imagesFailed={!!fileRes.error} nameOfUser={view.nameOf}
      view={sp.view === "timeline" || sp.view === "work-schedule" ? "timeline" : sp.view === "deliverables" ? "deliverables" : "breakdown"} deliverablesSlot={deliverablesSlot} openKey={typeof sp.open === "string" && /^D\d{3,}$/.test(sp.open) ? sp.open : null} today={todayIso()} />
    </div>
  );
}
