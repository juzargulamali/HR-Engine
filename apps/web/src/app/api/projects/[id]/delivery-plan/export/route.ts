import { NextResponse } from "next/server";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { loadDeliveryPlan } from "@/lib/projects/delivery-plan/data";
import { buildDeliveryPlanExport } from "@/lib/projects/delivery-plan/excel/workbook";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

/**
 * Excel export of one project's Delivery plan, in the shape the import reads back. The plan comes from `proj_dp_plan`, which applies the access rules itself; the only
 * other reads are names, under the signed-in person's own session: the project's members, the labels of the reference images and the names of the stock items.
 * No price, no chat, no file contents, no URL. A read that fails is said so: a partial workbook is never sent.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });
  if (ctx.loadFailed) return NextResponse.json({ error: "Could not load your Projects access. Nothing was exported; try again." }, { status: 503 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let view;
  try { view = await loadProjectView(ctx, id); } catch { return NextResponse.json({ error: "Could not load the project. Nothing was exported; try again." }, { status: 503 }); }
  if (!view) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (view.level !== "details") return NextResponse.json({ error: "The Delivery plan is for the people working on this project." }, { status: 403 });

  const read = await loadDeliveryPlan(id);
  if (read.state === "not_installed") return NextResponse.json({ error: "The Delivery plan is not installed in this environment yet." }, { status: 503 });
  if (read.state === "denied") return NextResponse.json({ error: "You cannot open this project's Delivery plan." }, { status: 403 });
  if (read.state === "error") return NextResponse.json({ error: "Could not load the Delivery plan. Nothing was exported; try again." }, { status: 503 });
  const plan = read.plan;

  const supabase = await createClient();
  const fileIds = [...new Set(plan.items.map((i) => i.image_file_id).filter((x): x is string => !!x))];
  const fileLabels: Record<string, string> = {};
  const stockNames: Record<string, string> = {};
  if (fileIds.length > 0) {
    const { data, error } = await supabase.from("proj_files").select("id, label, original_name").in("id", fileIds);
    // Reference image is export-only (never read back), so a failed read is stated in the cell.
    for (const f of fileIds) fileLabels[f] = error ? "Image attached (its name could not be loaded)" : "Image attached";
    for (const f of data ?? []) fileLabels[f.id] = f.label?.trim() || f.original_name?.trim() || "Image attached";
  }
  // The stock item names come with the plan itself (proj_dp_plan returns the name of each chosen item to every reader of the plan), so a member without
  // Inventory access exports the same workbook the Project Manager does.
  for (const l of plan.items.flatMap((i) => i.lines)) if (l.inv_item_id && l.inv_item_name) stockNames[l.inv_item_id] = l.inv_item_name;

  const bytes = await buildDeliveryPlanExport(plan, memberOptions(view), fileLabels, stockNames);
  const reference = view.project.reference.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="delivery-plan-${reference}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
