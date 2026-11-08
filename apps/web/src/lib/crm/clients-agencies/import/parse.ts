import type { CrmLeadSource, CrmOrganisationRole } from "@/types/crm";
import { cleanText, LEAD_SOURCES, LEAD_SOURCE_LABEL, normaliseCountry, normaliseEmail, normaliseName, normaliseRoles, normaliseWebsite, ORGANISATION_ROLES, ROLE_LABEL } from "../normalise";
import type { ContactInput } from "../write";
import { IMPORT_LIMITS, isExampleName, unneutralise } from "./xlsx";

/**
 * Spreadsheet rows to organisations. Accepts the template headers and the existing workbook's headers ("Client name", "location", "Type";
 * a serial-number column and any other column is ignored). Pure: nothing here reads or writes the database.
 */

export type Field = "name" | "country" | "type" | "website" | "contactName" | "contactTitle" | "contactEmail" | "contactPhone" | "lead" | "notes" | "ownerEmail";

const alias = (field: Field, ...names: string[]) => names.map((n) => [normaliseName(n), field] as const);
const HEADER_FIELDS = new Map<string, Field>([
  ...alias("name", "Organisation name", "Organization name", "Client name", "Name", "Organisation", "Client"),
  ...alias("country", "Country", "location"),
  ...alias("type", "Organisation type", "Organization type", "Type"),
  ...alias("website", "Website", "Web site"),
  ...alias("contactName", "Contact name"),
  ...alias("contactTitle", "Contact title", "Contact role"),
  ...alias("contactEmail", "Contact email", "Contact e-mail"),
  ...alias("contactPhone", "Contact phone"),
  ...alias("lead", "Lead source / exhibition", "Lead source", "Exhibition"),
  ...alias("notes", "Notes", "Note"),
  ...alias("ownerEmail", "Account owner work email", "Account owner work email (optional)", "Account owner email"),
]);

export interface ParsedRow {
  rowNumber: number;
  name: string;
  countryText: string;
  typeText: string;
  website: string;
  contact: { name: string; title: string; email: string; phone: string };
  leadText: string;
  notes: string;
  ownerEmail: string;
}

export interface Flag { row: number; kind: "type" | "country" | "website" | "owner" | "file"; message: string }
export interface RowError { row: number; message: string }

export interface ParsedOrg {
  key: string;
  name: string;
  /** Sheet row numbers of every row that named this organisation. */
  rows: number[];
  roles: CrmOrganisationRole[];
  countryCode: string | null;
  website: string | null;
  note: string | null;
  leadSource: CrmLeadSource | null;
  exhibition: string | null;
  ownerEmail: string | null;
  contacts: ContactInput[];
  flags: Flag[];
}

export interface ParsedFile {
  headerRow: number;
  ignoredColumns: string[];
  sourceRows: number;
  unnamedRows: number[];
  exampleRows: number;
  /** Rows (after the first) that repeated an organisation already named earlier in the file. */
  duplicateRows: { row: number; name: string }[];
  rowErrors: RowError[];
  orgs: ParsedOrg[];
}

export type ParseOutcome = { ok: true; file: ParsedFile } | { ok: false; error: string };

/** Lead source / exhibition cell: "Referral", "Exhibition", "Referral / Sample Expo", or just a show name (which means: met at an exhibition). */
export function parseLead(text: string): { leadSource: CrmLeadSource | null; exhibition: string | null } {
  const t = cleanText(text);
  if (!t) return { leadSource: null, exhibition: null };
  const bySource = (s: string): CrmLeadSource | null => {
    const k = normaliseName(s);
    return LEAD_SOURCES.find((x) => normaliseName(x) === k || normaliseName(LEAD_SOURCE_LABEL[x]) === k) ?? null;
  };
  const whole = bySource(t);
  if (whole) return { leadSource: whole, exhibition: null };
  const m = /^(.+?)\s+\/\s+(.+)$/.exec(t);
  if (m) { const s = bySource(m[1]!); if (s) return { leadSource: s, exhibition: cleanText(m[2]) }; }
  const ex = /^exhibition\s*:\s*(.+)$/i.exec(t);
  return { leadSource: "exhibition", exhibition: cleanText(ex ? ex[1] : t) };
}

/** The same person: same e-mail, or the same name where either side has no e-mail. Two people with one name and different e-mails are two people. */
export function sameContact(a: { name: string; email?: string | null }, b: { name: string; email?: string | null }): boolean {
  const ea = normaliseEmail(a.email);
  const eb = normaliseEmail(b.email);
  if (ea && eb) return ea === eb;
  return normaliseName(a.name) !== "" && normaliseName(a.name) === normaliseName(b.name);
}

export function exportLeadText(leadSource: CrmLeadSource | null, exhibition: string | null): string {
  if (leadSource && leadSource !== "exhibition" && exhibition) return `${LEAD_SOURCE_LABEL[leadSource]} / ${exhibition}`;
  if (exhibition && (!leadSource || leadSource === "exhibition")) return exhibition;
  return leadSource ? LEAD_SOURCE_LABEL[leadSource] : "";
}

export const rolesText = (roles: readonly CrmOrganisationRole[]) => ORGANISATION_ROLES.filter((r) => roles.includes(r)).map((r) => ROLE_LABEL[r]).join(", ");

function findHeader(rows: string[][]): { index: number; columns: Map<number, Field>; ignored: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const columns = new Map<number, Field>();
    const used = new Set<Field>();
    (rows[i] ?? []).forEach((text, c) => {
      const f = HEADER_FIELDS.get(normaliseName(text));
      if (f && !used.has(f)) { columns.set(c, f); used.add(f); }
    });
    if (used.has("name")) {
      const ignored = (rows[i] ?? []).map((t, c) => (columns.has(c) ? "" : t)).filter((t) => t !== "").slice(0, 20);
      return { index: i, columns, ignored };
    }
  }
  return null;
}

export function parseRows(rows: string[][]): ParseOutcome {
  const header = findHeader(rows);
  if (!header) return { ok: false, error: "Could not find an Organisation name column (or Client name). Use the template, or keep your own headers on one row." };
  const parsed: ParsedRow[] = [];
  const unnamedRows: number[] = [];
  const rowErrors: RowError[] = [];
  let sourceRows = 0;
  let exampleRows = 0;
  for (let i = header.index + 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    if (!cells.some((c) => c !== "")) continue;
    const rowNumber = i + 1;
    const get = (f: Field) => {
      for (const [c, field] of header.columns) if (field === f) return unneutralise(cells[c] ?? "");
      return "";
    };
    const name = get("name").replace(/\s+/g, " ").trim();
    if (isExampleName(name)) { exampleRows++; continue; }
    sourceRows++;
    if (sourceRows > IMPORT_LIMITS.maxRows) return { ok: false, error: `The file has more than ${IMPORT_LIMITS.maxRows} rows. Split it into smaller files.` };
    if (!name) { unnamedRows.push(rowNumber); continue; }
    if (!normaliseName(name)) { rowErrors.push({ row: rowNumber, message: "The organisation name has no letters or digits, so the row was skipped." }); continue; }
    if (name.length > 200) { rowErrors.push({ row: rowNumber, message: "The organisation name is longer than 200 characters, so the row was skipped." }); continue; }
    parsed.push({
      rowNumber, name, countryText: get("country"), typeText: get("type"), website: get("website"),
      contact: { name: get("contactName"), title: get("contactTitle"), email: get("contactEmail"), phone: get("contactPhone") },
      leadText: get("lead"), notes: get("notes"), ownerEmail: get("ownerEmail"),
    });
  }

  const byKey = new Map<string, ParsedOrg>();
  const duplicateRows: ParsedFile["duplicateRows"] = [];
  const baseNote = new Map<string, string>();
  const countryLines = new Map<string, string[]>();
  for (const r of parsed) {
    const key = normaliseName(r.name);
    let org = byKey.get(key);
    if (!org) {
      org = { key, name: r.name, rows: [], roles: [], countryCode: null, website: null, note: null, leadSource: null, exhibition: null, ownerEmail: null, contacts: [], flags: [] };
      byKey.set(key, org);
    } else duplicateRows.push({ row: r.rowNumber, name: org.name });
    org.rows.push(r.rowNumber);
    const flag = (kind: Flag["kind"], message: string) => org!.flags.push({ row: r.rowNumber, kind, message });
    const differs = (what: string, kept: string, other: string) => flag("file", `${what}: this row says "${other}" but the first row for this organisation says "${kept}". The first value is used.`);

    const types = normaliseRoles(r.typeText);
    for (const u of types.unknown) flag("type", `Unknown type "${u}": the type was left blank for review.`);
    for (const t of types.roles) if (!org.roles.includes(t)) org.roles.push(t);

    const countryText = cleanText(r.countryText);
    if (countryText) {
      const code = normaliseCountry(countryText);
      if (!code) {
        flag("country", `Country "${countryText}" is not recognised: kept in the notes for review.`);
        countryLines.set(key, [...new Set([...(countryLines.get(key) ?? []), `Country as given: ${countryText}`])]);
      } else if (!org.countryCode) org.countryCode = code;
      else if (org.countryCode !== code) differs("Country", org.countryCode, countryText);
    }

    const site = normaliseWebsite(r.website);
    if (site.website) {
      if (!site.domain) flag("website", `Website "${site.website.slice(0, 60)}" does not look like a web address and was not used.`);
      else if (!org.website) org.website = site.website.slice(0, 300);
    }

    const notes = cleanText(r.notes);
    if (notes && !baseNote.get(key)) baseNote.set(key, notes);
    else if (notes && baseNote.get(key) !== notes) differs("Notes", baseNote.get(key)!.slice(0, 40), notes.slice(0, 40));

    const lead = parseLead(r.leadText);
    if (lead.leadSource && !org.leadSource) { org.leadSource = lead.leadSource; org.exhibition = lead.exhibition; }
    else if (lead.leadSource && (org.leadSource !== lead.leadSource || (lead.exhibition && org.exhibition !== lead.exhibition))) differs("Lead source / exhibition", exportLeadText(org.leadSource, org.exhibition), r.leadText);

    const owner = cleanText(r.ownerEmail);
    if (owner && !org.ownerEmail) org.ownerEmail = owner;
    else if (owner && normaliseEmail(owner) !== normaliseEmail(org.ownerEmail)) differs("Account owner", org.ownerEmail ?? "", owner);

    const c = r.contact;
    const anyContact = [c.name, c.title, c.email, c.phone].some((x) => cleanText(x));
    if (anyContact) {
      const email = normaliseEmail(c.email);
      if (!cleanText(c.name)) rowErrors.push({ row: r.rowNumber, message: "A contact needs a name: the contact on this row was not used." });
      else if (cleanText(c.email) && !email) rowErrors.push({ row: r.rowNumber, message: `The e-mail address for ${c.name.slice(0, 60)} does not look right: the contact on this row was not used.` });
      else {
        const contact: ContactInput = { name: c.name.trim().slice(0, 200), role_title: cleanText(c.title)?.slice(0, 200) ?? null, email, phone: cleanText(c.phone)?.slice(0, 80) ?? null };
        const dup = org.contacts.find((x) => sameContact(x, contact));
        if (!dup) org.contacts.push(contact);
        else { dup.email ??= contact.email; dup.role_title ??= contact.role_title; dup.phone ??= contact.phone; }
      }
    }
  }
  for (const o of byKey.values()) {
    const note = [baseNote.get(o.key), ...(countryLines.get(o.key) ?? []).filter((l) => !(baseNote.get(o.key) ?? "").includes(l))].filter(Boolean).join("\n");
    o.note = note === "" ? null : note;
  }
  return { ok: true, file: { headerRow: header.index + 1, ignoredColumns: header.ignored, sourceRows, unnamedRows, exampleRows, duplicateRows, rowErrors, orgs: [...byKey.values()] } };
}
