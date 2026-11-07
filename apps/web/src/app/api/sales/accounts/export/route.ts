import { NextResponse } from "next/server";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff, loadSummaryInputs } from "@/lib/crm/clients-agencies/data";
import { filterDirectory, filtersFromParams } from "@/lib/crm/clients-agencies/directory";
import { buildExportWorkbook } from "@/lib/crm/clients-agencies/import/export";

export const maxDuration = 120;

/**
 * Excel export of the selected company's accounts: scope=filtered (the filters on the page) or scope=all (everything the person can read).
 * Everything is read through the signed-in person's own session, so the export shows exactly what they can already see.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await getCrmContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });
  if (ctx.loadFailed) return NextResponse.json({ error: "Could not load your Sales access." }, { status: 503 });
  const company = ctx.companies.find((c) => c.id === url.searchParams.get("company"));
  if (!company || !ctx.grants.some((g) => g.companyId === company.id)) return NextResponse.json({ error: "You do not have Sales access for that company." }, { status: 403 });
  const scope = url.searchParams.get("scope") === "filtered" ? "filtered" : "all";
  try {
    const [directory, staff, summary] = await Promise.all([loadDirectory(company.id), loadStaff(), loadSummaryInputs(company.id)]);
    const rows = scope === "filtered" ? filterDirectory(directory, filtersFromParams(Object.fromEntries(url.searchParams))) : directory;
    const bytes = await buildExportWorkbook(rows, staff, summary);
    const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="clients-agencies-${slug}-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[clients-agencies] export failed", e);
    return NextResponse.json({ error: "Could not load the accounts to export. Nothing was exported; try again." }, { status: 503 });
  }
}
