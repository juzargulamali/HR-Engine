import { quotationExport } from "@/lib/crm/quotations/export/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Download the quotation as pdf (issued: frozen snapshot only; draft: live and marked DRAFT). See lib/crm/quotations/export/handler.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  return quotationExport((await params).proposalId, "pdf");
}
