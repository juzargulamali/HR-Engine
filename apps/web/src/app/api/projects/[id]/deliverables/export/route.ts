import { NextResponse } from "next/server";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { loadRegister } from "@/lib/projects/phase2/data";
import { registerCsv } from "@/lib/projects/phase2/model";

/**
 * CSV export of the Deliverables register. It is built ONLY from `proj_deliverables_register`, the same read the screen uses, under the signed-in person's own session: a file, link or
 * name the requester may not open is already absent from what the database returns ("restricted file" with no name, address or size), so the export can never hold more than the screen.
 * A read that fails is said so: a partial file is never sent.
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
  if (view.level !== "details") return NextResponse.json({ error: "The deliverables register is for the people working on this project." }, { status: 403 });
  const res = await loadRegister(id);
  if (res.state === "not_installed") return NextResponse.json({ error: "Deliverables are not installed in this environment yet." }, { status: 503 });
  if (res.state === "denied") return NextResponse.json({ error: "You cannot open this project's deliverables." }, { status: 403 });
  if (res.state === "error") return NextResponse.json({ error: "Could not load the deliverables. Nothing was exported; try again." }, { status: 503 });
  const name = `deliverables-${view.project.reference.replace(/[^A-Za-z0-9._-]+/g, "-")}.csv`;
  return new NextResponse(registerCsv(res.data), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
