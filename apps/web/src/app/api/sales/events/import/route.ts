import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCrmContext } from "@/lib/crm/context";
import { IMPORT_LIMITS } from "@/lib/crm/clients-agencies/import/xlsx";
import { runEventsImport } from "@/lib/crm/events/import/service";

export const maxDuration = 120;

/**
 * Events & Exhibitions calendar import (.xlsx or .csv). mode=preview classifies every row and writes nothing; mode=confirm re-reads the file and hands the batch to the
 * database function, which re-checks permission, validation and duplicates and writes everything in one transaction or nothing. The signed-in person's own session is
 * used throughout. The calendar is shared by every company, so no company is chosen.
 */
export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > IMPORT_LIMITS.maxBytes + 256 * 1024) return NextResponse.json({ error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Upload a .xlsx or .csv file." }, { status: 400 }); }
  const file = form.get("file");
  const mode = form.get("mode") === "confirm" ? "confirm" : "preview";
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a .xlsx or .csv file." }, { status: 400 });
  if (file.size > IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` }, { status: 413 });
  const expectRaw = Number(form.get("expect"));
  const expect = Number.isInteger(expectRaw) && expectRaw >= 0 ? expectRaw : null;

  const res = await runEventsImport(
    { db: await createClient(), ctx: await getCrmContext() },
    { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mode, expect },
  );
  if (!res.ok) return NextResponse.json({ error: res.error, ...(res.code ? { code: res.code } : {}) }, { status: res.status });
  if (res.mode === "confirm") revalidatePath("/sales", "layout");
  return NextResponse.json(res);
}
