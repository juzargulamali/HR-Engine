import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { CloseoutDocument, closeoutPdfFileName } from "@/lib/pdf/closeout-document";
import { keyFacts, type ReportView } from "@/lib/projects/closeout/report";
import type { CloseoutReportRow } from "@/lib/projects/closeout/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Downloads an APPROVED closeout report as a PDF (the same pattern as the issued client timeline). The row is read with the caller's own session, so row-level security
 * decides: anyone who does not manage the project gets 404 exactly as if the report did not exist. A draft is never downloadable: it must be approved first. Nothing is
 * stored and nothing is sent to anyone: the PDF is rendered each time from the frozen version. A failed read says so; it is not reported as "not found".
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = await params;
  if (!UUID.test(id) || !UUID.test(reportId)) return plain("Not found", 404);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return plain("Sign in to download this file.", 401);
  const { data, error } = await supabase.from("proj_closeout_reports").select("*").eq("id", reportId).eq("project_id", id).maybeSingle();
  if (error) return plain("The report could not be loaded. Try again.", 503);
  const row = data as unknown as CloseoutReportRow | null;
  if (!row) return plain("Not found", 404);
  if (row.status !== "approved") return plain("This report is still a draft. Approve it before downloading.", 409);
  // The approver's display name comes from the frozen snapshot's own team list (the people who manage a project are on it).
  const approver = row.snapshot.team.find((m) => m.user_id === row.approved_by)?.name ?? null;
  const report: ReportView = {
    id: row.id, versionNo: row.version_no, status: row.status, version: row.version, generation: row.generation, snapshotAt: row.snapshot_at, approvedAt: row.approved_at,
    approvedBy: approver, facts: keyFacts(row.snapshot), missing: row.snapshot.missing ?? [], sections: row.sections, refs: row.source_refs, include: [],
  };
  const buffer = await renderToBuffer(createElement(CloseoutDocument, { report, projectName: row.snapshot.project.name, reference: row.snapshot.project.reference }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${closeoutPdfFileName(row.snapshot.project.reference, row.version_no)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
