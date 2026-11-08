import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuotationSnapshot } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CrmApprovalRow, CrmFileRow, CrmOrganisationRow, CrmProposalRow } from "@/types/crm";
import type { ApprovalLite, QuotationHeader, QuotationLineRow, QuotationSectionRow, VatChoiceRow } from "./model";

/** The quotation tables are not in the generated database types; reads go through the signed-in person's own session (RLS). */
const untyped = async () => (await createClient()) as unknown as SupabaseClient;

/** A failed query must surface as an error, never as "no quotations". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Quotations could not be loaded: ${r.error.message}`);
}

export interface QuotationListItem { header: QuotationHeader; proposal: CrmProposalRow; totalGross: string | null }

/** Quotations of one enquiry, newest first. Issued ones show their frozen total; drafts show none (the editor computes it live). */
export async function loadQuotationList(opportunityId: string, proposals: readonly CrmProposalRow[]): Promise<QuotationListItem[]> {
  const db = await untyped();
  const [q, s] = await Promise.all([
    db.from("crm_quotations").select("*").eq("opportunity_id", opportunityId),
    db.from("crm_quotation_snapshots").select("proposal_id, content").eq("opportunity_id", opportunityId),
  ]);
  ok(q, s);
  const byProposal = new Map(proposals.map((p) => [p.id, p]));
  const gross = new Map((s.data ?? []).map((r: { proposal_id: string; content: QuotationSnapshot }) => [r.proposal_id, r.content.totals.gross]));
  return ((q.data ?? []) as QuotationHeader[])
    .flatMap((header) => { const proposal = byProposal.get(header.proposal_id); return proposal ? [{ header, proposal, totalGross: gross.get(header.proposal_id) ?? null }] : []; })
    .sort((a, b) => b.proposal.version - a.proposal.version);
}

export interface OrgOption { id: string; name: string; country_code: string | null; place: string | null; vat_trn: string | null; trade_licence_no: string | null }
export interface IssuerLite { id: string; legal_name: string; trn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logo_path: string | null }
export interface QuotationBundle {
  header: QuotationHeader;
  proposal: CrmProposalRow;
  sections: QuotationSectionRow[];
  lines: QuotationLineRow[];
  vatChoices: VatChoiceRow[];
  issuer: IssuerLite;
  organisations: OrgOption[];
  billTo: OrgOption | null;
  files: CrmFileRow[];
  /** line image file id -> short-lived signed address (best effort; missing = show the file name only). */
  imageUrls: Record<string, string>;
  approvals: ApprovalLite[];
  /** The version fingerprint of the client-facing content as it is now (crm_quote_content_hash): the reviewer screen carries it back when approving. Null for an issued quotation or when it could not be computed. */
  contentHash: string | null;
  /** Present once issued: THE frozen client-facing copy. Part 2 (PDF / XLSX) renders this and nothing else. */
  snapshot: { content: QuotationSnapshot; content_hash: string; issued_at: string } | null;
  /** The revision chain of this reference, newest first. */
  revisions: { proposal_id: string; revision: number; issued: boolean; status: string }[];
}

export async function loadQuotation(proposalId: string): Promise<QuotationBundle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return null;
  const db = await untyped();
  const h = await db.from("crm_quotations").select("*").eq("proposal_id", proposalId).maybeSingle();
  ok(h);
  const header = h.data as QuotationHeader | null;
  if (!header) return null;
  const [p, sec, lin, vat, co, orgs, files, appr, snap, chain] = await Promise.all([
    db.from("crm_proposals").select("*").eq("id", proposalId).single(),
    db.from("crm_quotation_sections").select("*").eq("proposal_id", proposalId).order("position"),
    db.from("crm_quotation_lines").select("*").eq("proposal_id", proposalId).order("position"),
    db.from("crm_quote_vat_choices").select("*").eq("company_id", header.company_id).order("position"),
    db.from("companies").select("id, legal_name, trn, address, phone, email, website, logo_path").eq("id", header.company_id).single(),
    db.from("crm_organisations").select("id, name, country_code, place, vat_trn, trade_licence_no").is("archived_at", null).order("name"),
    db.from("crm_files").select("*").eq("opportunity_id", header.opportunity_id).is("deleted_at", null),
    db.from("crm_approvals").select("id, proposal_id, state, decided_at, requested_at, quote_content_hash").eq("proposal_id", proposalId),
    db.from("crm_quotation_snapshots").select("content, content_hash, issued_at").eq("proposal_id", proposalId).maybeSingle(),
    db.from("crm_quotations").select("proposal_id, revision, issued_at").eq("company_id", header.company_id).eq("reference", header.reference).order("revision", { ascending: false }),
  ]);
  ok(p, sec, lin, vat, co, orgs, files, appr, snap, chain);
  const chainIds = ((chain.data ?? []) as { proposal_id: string; revision: number; issued_at: string | null }[]);
  const st = await db.from("crm_proposals").select("id, status").in("id", chainIds.map((c) => c.proposal_id));
  ok(st);
  let contentHash: string | null = null;
  if (!header.issued_at) {
    const hr = await db.rpc("crm_quote_content_hash", { p_proposal: proposalId });
    ok(hr);
    contentHash = (hr.data as string | null) ?? null;
  }
  const statusBy = new Map(((st.data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]));
  const lines = (lin.data ?? []) as QuotationLineRow[];
  const fileRows = (files.data ?? []) as CrmFileRow[];
  const organisations = (orgs.data ?? []) as OrgOption[];

  // Thumbnails: signed addresses for line pictures, created only after the person's own session could read this quotation.
  const imageUrls: Record<string, string> = {};
  const wanted = fileRows.filter((f) => lines.some((l) => l.image_file_id === f.id) && f.storage_path);
  if (wanted.length > 0) {
    try {
      const { data } = await createAdminClient().storage.from("crm-files").createSignedUrls(wanted.map((f) => f.storage_path!), 600);
      (data ?? []).forEach((r, i) => { if (r.signedUrl) imageUrls[wanted[i]!.id] = r.signedUrl; });
    } catch { /* thumbnails are optional */ }
  }
  return {
    header, proposal: p.data as CrmProposalRow, sections: (sec.data ?? []) as QuotationSectionRow[], lines, vatChoices: (vat.data ?? []) as VatChoiceRow[],
    issuer: co.data as IssuerLite, organisations, billTo: organisations.find((o) => o.id === header.bill_to_org_id) ?? null,
    files: fileRows, imageUrls, approvals: (appr.data ?? []) as ApprovalLite[], contentHash,
    snapshot: (snap.data as QuotationBundle["snapshot"]) ?? null,
    revisions: chainIds.map((c) => ({ proposal_id: c.proposal_id, revision: c.revision, issued: !!c.issued_at, status: statusBy.get(c.proposal_id) ?? "draft" })),
  };
}

export type { CrmApprovalRow, CrmOrganisationRow };
