import "server-only";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCrmContext } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { QuotationDocument } from "@/lib/pdf/quotation-document";
import { loadQuotation } from "../data";
import { exportBaseName, modelFromDraft, modelFromSnapshot, type QuotationDocModel } from "./doc-model";
import { loadExportAssets, readFromStorage, type StorageReader } from "./images";
import { buildQuotationWorkbook } from "./xlsx";

export type ExportKind = "pdf" | "xlsx";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
const text = (status: number, body: string, extra: Record<string, string> = {}) => new Response(body, { status, headers: { ...headers, ...extra } });

/** Where stored pictures come from. Tests replace it; production reads storage with the service client AFTER the caller's own session has read the quotation. */
export const exportSeams: { storage: StorageReader } = { storage: readFromStorage };

/**
 * Downloads a quotation as PDF or Excel. Everything is read with the CALLER's session (row-level security decides: an unreadable quotation is 404). An ISSUED
 * revision (current or superseded) is rendered ONLY from its frozen snapshot, never from live account, company or template rows; a DRAFT is rendered from the
 * live draft through the same shared calculation and is marked DRAFT everywhere. Nothing is stored or sent.
 */
export async function quotationExport(proposalId: string, kind: ExportKind): Promise<Response> {
  if (!UUID.test(proposalId)) return text(404, "Not found");
  const ctx = await getCrmContext();
  if (!ctx) return text(401, "Sign in to download this file.");
  if (ctx.loadFailed) return text(503, "Could not load your Sales access, so no file was made. Try again in a moment.", { "Retry-After": "5" });
  if (ctx.grants.length === 0) return text(403, "You do not have Sales access.");

  let model: QuotationDocModel;
  try {
    const bundle = await loadQuotation(proposalId);
    if (!bundle) return text(404, "Not found");
    if (!ctx.grants.some((g) => g.companyId === bundle.header.company_id)) return text(403, "You do not have Sales access for that company.");
    if (bundle.header.issued_at) {
      // Issued: the frozen snapshot only. If it cannot be read there is no file (never a fallback to live data).
      if (!bundle.snapshot) return text(503, "The issued copy could not be loaded, so no file was made. Try again in a moment.", { "Retry-After": "5" });
      model = modelFromSnapshot(bundle.snapshot.content);
    } else {
      const supabase = (await createClient()) as unknown as SupabaseClient;
      const opp = await supabase.from("crm_opportunities").select("reference, title").eq("id", bundle.header.opportunity_id).maybeSingle();
      if (opp.error) throw new Error(opp.error.message);
      if (!opp.data) return text(404, "Not found");
      model = modelFromDraft({
        header: bundle.header, sections: bundle.sections, lines: bundle.lines, issuer: bundle.issuer, files: bundle.files,
        billTo: bundle.billTo ? { name: bundle.billTo.name, place: bundle.billTo.place, country_code: bundle.billTo.country_code, vat_trn: bundle.billTo.vat_trn, trade_licence_no: bundle.billTo.trade_licence_no } : null,
        enquiry: { reference: (opp.data as { reference: string }).reference, title: (opp.data as { title: string }).title },
      });
    }
  } catch (e) {
    console.error("[quotations] export: the quotation could not be read", e instanceof Error ? e.message : e);
    return text(503, "The quotation could not be loaded, so no file was made. Try again in a moment.", { "Retry-After": "5" });
  }

  let body: Uint8Array;
  let missing = 0;
  try {
    const assets = await loadExportAssets(model, exportSeams.storage);
    missing = assets.missing;
    body = kind === "pdf"
      ? new Uint8Array(await renderToBuffer(createElement(QuotationDocument, { model, assets }) as Parameters<typeof renderToBuffer>[0]))
      : await buildQuotationWorkbook(model, assets);
  } catch (e) {
    console.error("[quotations] export: the file could not be made", e instanceof Error ? e.message : e);
    return text(500, "The file could not be made. Try again in a moment.");
  }
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportBaseName(model)}.${kind}"`,
      "X-Content-Type-Options": "nosniff",
      "X-Quotation-Draft": model.draft ? "yes" : "no",
      "X-Quotation-Pictures-Missing": String(missing),
      ...headers,
    },
  });
}
