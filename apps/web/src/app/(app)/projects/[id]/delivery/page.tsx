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
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Delivery plan" };

/**
 * The Delivery Plan of one project: deliverables by zone, each with the breakdown sections that apply. Every member of the project reads all of it. Whoever manages the
 * project edits deliverable rows and releases; a section's delegate edits that section's lines; any member raises a correction. Work is entered once here: Release creates
 * the tasks and adds hardware to the DRAFT equipment request (submitting that to the warehouse stays on the Equipment tab). Progress is read from those records.
 */
export default async function DeliveryPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);
  const heading = <h2 className="text-lg font-semibold">Delivery plan</h2>;

  const res = await loadDeliveryPlan(id);
  if (res.state === "not_installed") return <div className="space-y-4">{heading}<Alert role="status">The Delivery plan is not installed in this environment yet. Nothing else about this project is affected.</Alert></div>;
  if (res.state === "denied") return <div className="space-y-4">{heading}<Alert role="status">The Delivery plan is for the people working on this project. The Project Manager can add you if you should take part.</Alert></div>;
  if (res.state === "error") return <div className="space-y-4">{heading}<LoadError what="the delivery plan" retryHref={`/projects/${id}/delivery`} /></div>;
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

  return (
    <DeliveryPlanView projectId={id} plan={plan} userId={ctx.userId} readOnly={readOnly} statusWord={view.project.status} members={members} stock={stock} stockFailed={!!stockRes.error}
      images={images} imagesFailed={!!fileRes.error} nameOfUser={view.nameOf} />
  );
}
