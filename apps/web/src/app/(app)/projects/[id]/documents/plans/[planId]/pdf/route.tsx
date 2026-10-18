import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { IssuedPlanPayload } from "@enginious-hr/domain";
import { PlanDocument } from "@/lib/pdf/plan-document";
import { planPdfFileName } from "@/lib/pdf/plan-layout";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

/**
 * Downloads an issued client timeline as a PDF. The plan row is read with the caller's own session, so row-level security decides:
 * a person who is not (or is no longer) a member of the project, or a founder of its company, gets 404 exactly as if it did not
 * exist. Nothing is stored: the PDF is rendered from the immutable issued payload each time, and generating it sends nothing to anyone.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id, planId } = await params;
  if (!UUID.test(id) || !UUID.test(planId)) return notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { data: plan } = await supabase.from("proj_issued_plans").select("*").eq("id", planId).eq("project_id", id).maybeSingle();
  if (!plan) return notFound();

  const payload = plan.payload as unknown as IssuedPlanPayload;
  const buffer = await renderToBuffer(
    createElement(PlanDocument, { payload, version: plan.version, clientReference: plan.client_reference, title: plan.title, tz: plan.tz, issuedAt: plan.issued_at }) as Parameters<typeof renderToBuffer>[0],
  );
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${planPdfFileName(payload.project?.reference ?? plan.client_reference, plan.version)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
