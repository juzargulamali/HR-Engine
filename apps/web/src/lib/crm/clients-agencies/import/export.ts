import { deriveAccount, type ActivityLite, type OppLite, type ProjectLite, type ProposalLite, type Section, type ZohoLite } from "../account";
import { countryLabel } from "../normalise";
import type { DirectoryRow } from "../directory";
import type { StaffPerson } from "../staff";
import { exportLeadText, rolesText } from "./parse";
import { ORGANISATIONS_SHEET, SUMMARY_SHEET, TEMPLATE_HEADERS, buildWorkbook, type SheetTable } from "./xlsx";

/** Rows of the export workbook. Sheet 1 has the import template's headers (one row per contact); sheet 2 is derived and never imported. */

export const OWNER_NAME_HEADER = "Account owner name (not imported)";
export const PLACE_HEADER = "City or place (not imported)";

export function organisationsTable(rows: readonly DirectoryRow[], staff: readonly StaffPerson[]): SheetTable {
  // E-mail addresses reach the caller only when the database shows them (a Sales founder); everyone else gets the owner's name instead.
  const mayShowEmails = staff.some((p) => p.email != null);
  const headers = TEMPLATE_HEADERS.map((h) => (h === "Account owner work email" && !mayShowEmails ? OWNER_NAME_HEADER : h));
  const person = (id: string | null) => staff.find((p) => p.userId === id);
  const out: (string | null)[][] = [];
  for (const r of rows) {
    const owner = person(r.profile?.owner_id ?? null);
    const ownerCell = mayShowEmails ? owner?.email ?? "" : owner?.name ?? (r.profile?.owner_id ? "Former colleague" : "");
    const org = [r.org.name, countryLabel(r.org.country_code), rolesText(r.org.roles), r.org.website ?? ""];
    const tail = [exportLeadText(r.profile?.lead_source ?? null, r.profile?.exhibition ?? null), r.org.note ?? "", ownerCell, r.org.vat_trn ?? "", r.org.trade_licence_no ?? "", r.org.place ?? ""];
    if (r.contacts.length === 0) out.push([...org, "", "", "", "", ...tail]);
    for (const c of r.contacts) out.push([...org, c.name, c.role_title ?? "", c.email ?? "", c.phone ?? "", ...tail]);
  }
  return { name: ORGANISATIONS_SHEET, headers: [...headers, PLACE_HEADER], rows: out, widths: [34, 20, 20, 24, 22, 20, 30, 18, 26, 34, 32, 26, 22, 20] };
}

export interface SummaryInputs {
  companyId: string;
  opportunities: readonly OppLite[];
  proposals: readonly ProposalLite[];
  zoho: readonly ZohoLite[];
  activities: readonly ActivityLite[];
  projects: Section<readonly ProjectLite[]>;
}

export const SUMMARY_DEFINITIONS = [
  "Derived figures for the selected company only, counted exactly as on each account page. Changing a number here has no effect: the import ignores this sheet.",
  "Inquiries: every inquiry of the company naming the account as its agency or its end client, counted once. Open: not won or lost. Won and Lost: by stage.",
  "Direct, Through an agency and As the agency add up to Inquiries. Quotes: proposals and recorded quote references. Awaiting reply: quote sent, inquiry open, no client response recorded since.",
  "A won inquiry is not a completed project. Completed projects counts projects you can open, once each; 'Could not load' means the projects could not be read.",
] as const;

export function summaryTable(rows: readonly DirectoryRow[], input: SummaryInputs, now: Date = new Date()): SheetTable {
  const byOrg = new Map<string, OppLite[]>();
  for (const o of input.opportunities) for (const id of new Set([o.agency_org_id, o.client_org_id])) if (id) byOrg.set(id, [...(byOrg.get(id) ?? []), o]);
  const none = { status: "ok", data: new Map<string, string>() } as const;
  const lines = rows.map((r) => {
    const opps = byOrg.get(r.org.id) ?? [];
    const ids = new Set(opps.map((o) => o.id));
    const v = deriveAccount({
      orgId: r.org.id, companyId: input.companyId, now, opportunities: opps,
      proposals: input.proposals.filter((p) => ids.has(p.opportunity_id)), zoho: input.zoho.filter((z) => ids.has(z.opportunity_id)),
      activities: input.activities.filter((a) => ids.has(a.opportunity_id)), followUps: [], projects: input.projects, handovers: none,
    });
    const c = v.counts;
    return [r.org.name, c.inquiries, c.open, c.won, c.lost, c.direct, c.throughAgency, c.asAgency, v.quotes.length, c.inquiriesAwaitingReply, c.completedProjects ?? "Could not load"];
  });
  return {
    name: SUMMARY_SHEET,
    headers: ["Organisation name", "Inquiries", "Open", "Won", "Lost", "Direct", "Through an agency", "As the agency", "Quotes", "Quotes awaiting reply", "Completed projects"],
    rows: lines, widths: [34, 12, 10, 10, 10, 10, 18, 14, 10, 20, 20], footer: SUMMARY_DEFINITIONS,
  };
}

export const buildExportWorkbook = (rows: readonly DirectoryRow[], staff: readonly StaffPerson[], summary: SummaryInputs, now?: Date) =>
  buildWorkbook([organisationsTable(rows, staff), summaryTable(rows, summary, now)]);
