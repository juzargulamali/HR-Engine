import { NextResponse } from "next/server";
import { getCrmContext } from "@/lib/crm/context";
import { buildEventsTemplate } from "@/lib/crm/events/import/template";

/** The blank calendar import template, generated on request (nothing is stored). Signed-in people with Sales access only. */
export async function GET() {
  const ctx = await getCrmContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to download the template." }, { status: 401 });
  if (ctx.loadFailed) return NextResponse.json({ error: "Could not load your Sales access." }, { status: 503 });
  if (ctx.grants.length === 0) return NextResponse.json({ error: "You do not have Sales access." }, { status: 403 });
  const bytes = await buildEventsTemplate();
  return new NextResponse(Buffer.from(bytes), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="events-import-template.xlsx"', "cache-control": "no-store" },
  });
}
