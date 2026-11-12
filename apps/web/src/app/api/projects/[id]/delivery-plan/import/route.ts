import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { IMPORT_LIMITS } from "@/lib/crm/clients-agencies/import/xlsx";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions, type ProjectView } from "@/lib/projects/data";
import { loadDeliveryPlan } from "@/lib/projects/delivery-plan/data";
import { runDeliveryPlanImport } from "@/lib/projects/delivery-plan/excel/service";
import type { Resolutions } from "@/lib/projects/delivery-plan/excel/plan";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

/**
 * Delivery plan Excel import. mode=preview compares the workbook with the plan and writes nothing; mode=confirm reads the file again, compares it again with the plan
 * as it is now, and hands the batch to `proj_dp_apply_import`, which re-checks every permission, turns changes to released rows into proposals, and refuses the whole
 * batch if the plan changed since the preview (`rev`). The signed-in person's own session is used throughout. Importing never releases anything.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mb = IMPORT_LIMITS.maxBytes / 1024 / 1024;
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > IMPORT_LIMITS.maxBytes + 256 * 1024) return NextResponse.json({ error: `The file is larger than ${mb} MB.` }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Upload a .xlsx file." }, { status: 400 }); }
  const file = form.get("file");
  const mode = form.get("mode") === "confirm" ? "confirm" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a .xlsx file." }, { status: 400 });
  if (file.size > IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: `The file is larger than ${mb} MB.` }, { status: 413 });
  const revText = form.get("rev");
  const revRaw = typeof revText === "string" && revText !== "" ? Number(revText) : NaN;
  const rev = Number.isInteger(revRaw) && revRaw >= 0 ? revRaw : null;

  let resolutions: Resolutions = {};
  try {
    const raw = form.get("resolutions");
    if (typeof raw === "string" && raw.length > 0 && raw.length < 600_000) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((v) => typeof v === "string")) resolutions = parsed as Resolutions;
    }
  } catch { /* malformed answers are treated as no answers: the rows then still need attention and nothing is imported */ }

  const ctx = await getProjectsContext();
  if (ctx?.loadFailed) return NextResponse.json({ error: "Could not load your Projects access. Nothing was imported; try again." }, { status: 503 });
  let view: ProjectView | null = null;
  if (ctx && /^[0-9a-f-]{36}$/i.test(id)) {
    try { view = await loadProjectView(ctx, id); } catch { return NextResponse.json({ error: "Could not load the project. Nothing was imported; try again." }, { status: 503 }); }
  }
  const supabase = await createClient();
  const res = await runDeliveryPlanImport(
    {
      db: supabase,
      signedIn: !!ctx,
      project: view ? { id: view.project.id, companyId: view.project.company_id, status: view.project.status, level: view.level } : null,
      loadPlan: loadDeliveryPlan,
      loadPeople: async () => (view ? memberOptions(view) : []),
      // Under the person's own session; read in pages so a long stock list is not cut short. Any failed page = the list could not be loaded.
      loadInventoryItems: async (companyId) => {
        const out: { id: string; name: string }[] = [];
        for (let from = 0; from < 20000; from += 1000) {
          const { data, error } = await supabase.from("inv_items").select("id, name, status").eq("company_id", companyId).neq("status", "retired").order("id").range(from, from + 999);
          if (error || !data) return null;
          for (const i of data) out.push({ id: i.id, name: i.name });
          if (data.length < 1000) break;
        }
        return out;
      },
    },
    { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mode, rev, resolutions },
  );
  if (!res.ok) return NextResponse.json({ error: res.error, ...(res.code ? { code: res.code } : {}) }, { status: res.status });
  if (res.mode === "confirm") revalidatePath("/projects", "layout");
  return NextResponse.json(res);
}
