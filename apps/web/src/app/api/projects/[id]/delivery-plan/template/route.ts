import { NextResponse } from "next/server";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { buildDeliveryPlanTemplate } from "@/lib/projects/delivery-plan/excel/workbook";

/** The blank Delivery plan workbook, generated on request (nothing is stored). For any signed-in person who can read this project's details. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to download the template." }, { status: 401 });
  if (ctx.loadFailed) return NextResponse.json({ error: "Could not load your Projects access. Try again." }, { status: 503 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let view;
  try { view = await loadProjectView(ctx, id); } catch { return NextResponse.json({ error: "Could not load the project. Try again." }, { status: 503 }); }
  if (!view) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (view.level !== "details") return NextResponse.json({ error: "The Delivery plan is for the people working on this project." }, { status: 403 });
  const bytes = await buildDeliveryPlanTemplate();
  return new NextResponse(Buffer.from(bytes), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="delivery-plan-template.xlsx"', "cache-control": "no-store" },
  });
}
