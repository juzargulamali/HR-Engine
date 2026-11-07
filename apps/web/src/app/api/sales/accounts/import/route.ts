import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff } from "@/lib/crm/clients-agencies/data";
import { IMPORT_LIMITS } from "@/lib/crm/clients-agencies/import/xlsx";
import { runImport } from "@/lib/crm/clients-agencies/import/service";

export const maxDuration = 300;

/**
 * Clients & Agencies Excel import. mode=preview compares the file with what is recorded and writes nothing; mode=confirm re-reads the
 * file and the database, then hands the batch to the database function that locks, fills only what is empty and refuses a stale preview. The signed-in person's own session is used throughout, so row-level security
 * and the part 1 database functions decide what is allowed.
 */
export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > IMPORT_LIMITS.maxBytes + 256 * 1024) return NextResponse.json({ error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Upload a .xlsx file." }, { status: 400 }); }
  const file = form.get("file");
  const companyId = String(form.get("companyId") ?? "");
  const mode = form.get("mode") === "confirm" ? "confirm" : "preview";
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(companyId)) return NextResponse.json({ error: "Choose a company and a .xlsx file." }, { status: 400 });
  if (file.size > IMPORT_LIMITS.maxBytes) return NextResponse.json({ error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.` }, { status: 413 });

  let fingerprints: Record<string, string> | undefined;
  try {
    const raw = form.get("fingerprints");
    if (typeof raw === "string" && raw.length > 0 && raw.length < 600_000) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((v) => typeof v === "string")) fingerprints = parsed as Record<string, string>;
    }
  } catch { /* a malformed token is treated as no token: the confirm asks for a preview first */ }

  const ctx = await getCrmContext();
  const res = await runImport(
    { db: await createClient(), ctx, loadDirectory, loadStaff },
    { companyId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mode, fingerprints },
  );
  if (!res.ok) return NextResponse.json({ error: res.error, ...(res.code ? { code: res.code } : {}) }, { status: res.status });
  if (res.mode === "confirm") revalidatePath("/sales", "layout");
  return NextResponse.json(res);
}
