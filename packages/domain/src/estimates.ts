/**
 * Estimates only: the pure rules of the estimate format (no database, no clock, no I/O).
 *
 * An estimate is a budgetary document. It is never a quotation, an offer or an agreement to supply, so the wording a client sees comes from here, once:
 *   - the MANDATORY budgetary notice (a constant, versioned, printed above the BOQ on page one of the PDF and at the top of the Excel sheet; no editor can
 *     remove or replace it, and the optional notes cannot hold it);
 *   - how an estimate is recognised (the format marker stored in the frozen snapshot, see `ESTIMATE_FORMAT_MARKER`);
 *   - the optional client notes (Assumptions, Exclusions, Next steps) and how they are stored with the existing columns (no database change);
 *   - the numbering of an estimate whose items may sit outside any section.
 *
 * Why a format marker: the database that builds the frozen snapshot is unchanged by this release, so a snapshot cannot carry a new schema version. The marker is
 * written to `crm_quotations.terms_label` by the server (never a user field), the database copies it into the snapshot's `terms.label`, and the exports read it
 * from there. A snapshot WITHOUT the marker is a historical quotation: it keeps rendering exactly as it was issued.
 */

/**
 * Increase when the notice wording or the page layout changes: an estimate keeps the notice AND the layout of the version it was finalised under.
 *   1: the estimates-only release (issuer contact line in the page header, no sales footer line).
 *   2: issuer branding: logo and issuer block at the top, "TRN: <value>", the multi-line address, and the sales enquiries line in the footer of every page.
 */
export const ESTIMATE_FORMAT_VERSION = 2;
/** Stored in `terms_label` of the estimate and copied into the snapshot's `terms.label`. Not a user field: the server sets it. */
export const ESTIMATE_FORMAT_MARKER = `estimate-format:${ESTIMATE_FORMAT_VERSION}`;

/** The owner's mandatory notice, version 1. Single source: the builder preview, the PDF and the Excel sheet all print this constant. */
export const BUDGETARY_NOTICE_V1 =
  "This is a budgetary estimate for planning purposes only. It is not a quotation or an offer, does not reserve any equipment, stock or dates, and is not an agreement to supply. Prices and availability are subject to review and written confirmation.";

/** Notice wording by format version (an older estimate re-exports with the wording it was finalised under). */
export const ESTIMATE_NOTICES: Readonly<Record<number, string>> = { 1: BUDGETARY_NOTICE_V1, 2: BUDGETARY_NOTICE_V1 };
/** First format version whose exports carry the issuer branding layout (header block + sales enquiries footer). Version 1 renders exactly as it was finalised. */
export const ISSUER_BRANDING_FROM_VERSION = 2;
/** The notice for NEW estimates. */
export const BUDGETARY_NOTICE = ESTIMATE_NOTICES[ESTIMATE_FORMAT_VERSION]!;

/** The format version of a stored `terms_label` / snapshot `terms.label`, or null when it is not an estimate (a historical quotation or an unmarked draft). */
export function estimateFormatVersion(termsLabel: string | null | undefined): number | null {
  const m = /^estimate-format:(\d{1,4})$/.exec(termsLabel ?? "");
  if (!m) return null;
  const v = Number(m[1]);
  return ESTIMATE_NOTICES[v] ? v : null;
}
export const isEstimateFormat = (termsLabel: string | null | undefined): boolean => estimateFormatVersion(termsLabel) !== null;

/** "Review pricing after" (the stored `validity_date`): never a price guarantee. */
export const REVIEW_PRICING_LABEL = "Review pricing after";
export const reviewPricingSentence = (isoDate: string): string => `Pricing to be reviewed after ${isoDate}. This is not a price guarantee.`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Client notes
// ---------------------------------------------------------------------------------------------------------------------------------
/** Headings of the optional client notes, in the order they print. Exclusions keep their own list (`crm_quotations.exclusions`). */
export const NOTE_HEADINGS = { assumptions: "Assumptions", exclusions: "Exclusions", nextSteps: "Next steps" } as const;
/** The database allows 3000 characters per clause body (crm_quote_save_header). */
export const CLIENT_NOTE_MAX = 3000;

export interface ClientNotes { assumptions: string; nextSteps: string }
export interface NoteClause { title: string; body: string }

/** Assumptions and Next steps are stored as two clauses of `terms` with these reserved titles. Empty notes are not stored. */
export function notesToClauses(n: ClientNotes): NoteClause[] {
  const out: NoteClause[] = [];
  if (n.assumptions.trim()) out.push({ title: NOTE_HEADINGS.assumptions, body: n.assumptions.trim() });
  if (n.nextSteps.trim()) out.push({ title: NOTE_HEADINGS.nextSteps, body: n.nextSteps.trim() });
  return out;
}
/** Reads the notes back. Any other clause (for example the six historical standard terms copied into an old draft) is ignored: it never reaches a client file. */
export function clausesToNotes(clauses: readonly NoteClause[] | null | undefined): ClientNotes {
  const find = (title: string) => (clauses ?? []).find((c) => c.title === title)?.body ?? "";
  return { assumptions: find(NOTE_HEADINGS.assumptions), nextSteps: find(NOTE_HEADINGS.nextSteps) };
}
/** Null when fine, otherwise a sentence. */
export function validateClientNotes(n: ClientNotes): string | null {
  if (n.assumptions.length > CLIENT_NOTE_MAX) return `Assumptions are too long (${CLIENT_NOTE_MAX} characters at most).`;
  if (n.nextSteps.length > CLIENT_NOTE_MAX) return `Next steps are too long (${CLIENT_NOTE_MAX} characters at most).`;
  return null;
}
/** Paragraphs of a note: separated by blank lines; a single line break stays inside its paragraph. Empty paragraphs are dropped. */
export function noteParagraphs(text: string): string[] {
  return text.split(/\r?\n[ \t]*\r?\n/).map((p) => p.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Items outside any section
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * The table requires every item to belong to a section, so an item added with no section lives in ONE hidden default section whose title is this constant.
 * It is never printed (no heading, no subtotal) and never numbered as a section. Matching is case-insensitive and ignores surrounding spaces.
 */
export const UNSECTIONED_TITLE = "(no section)";
export const isUnsectionedTitle = (title: string | null | undefined): boolean => (title ?? "").trim().toLowerCase() === UNSECTIONED_TITLE;

/** Puts the unsectioned block first (stable otherwise): it is the list of items typed before any section was added. */
export function unsectionedFirst<T extends { title: string }>(sections: readonly T[]): T[] {
  return [...sections.filter((s) => isUnsectionedTitle(s.title)), ...sections.filter((s) => !isUnsectionedTitle(s.title))];
}

/**
 * THE numbering of an estimate. Defined for every mix:
 *   - unsectioned items are numbered 1, 2, 3 ... in the order they are shown (they come first);
 *   - titled sections are numbered 1, 2, 3 ... by their order among the titled sections only, and their items are 1.1, 1.2, 2.1 ...;
 *   - the number of an item is therefore either a whole number (no section) or `<section>.<item>` (never both shapes for one item).
 * Input is in display order with the unsectioned block first (`unsectionedFirst`). Text out, never a number ("1.10" stays "1.10"). With no unsectioned
 * section this is exactly `sectionDisplayNumber` / `lineDisplayNumber`, so every historical numbering is unchanged.
 */
export function estimateNumbering(sections: readonly { unsectioned: boolean; lineCount: number }[]): { section: (string | null)[]; lines: string[][] } {
  let titled = 0;
  let loose = 0;
  const section: (string | null)[] = [];
  const lines: string[][] = [];
  for (const s of sections) {
    if (s.unsectioned) {
      section.push(null);
      lines.push(Array.from({ length: s.lineCount }, () => String((loose += 1))));
    } else {
      titled += 1;
      section.push(String(titled));
      lines.push(Array.from({ length: s.lineCount }, (_, i) => `${titled}.${i + 1}`));
    }
  }
  return { section, lines };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Issuer branding: the sales enquiries line and the website link
// ---------------------------------------------------------------------------------------------------------------------------------
/** Fixed label in code (not a company value) of the footer line. */
export const SALES_ENQUIRIES_LABEL = "Sales enquiries:";
export const CONTACT_SEPARATOR = " \u00b7 ";

/**
 * The website of the issuer as an absolute https URL, or null when it must not become a link. `www.example.ae` and `https://www.example.ae` both give
 * `https://www.example.ae`; `http://` is upgraded to https. Only http(s) is ever linked: any other scheme (javascript:, data:, file:, mailto:, ftp: ...),
 * a protocol-relative `//host`, embedded spaces or control characters, credentials in the URL, or a host without a dot give null (the text is then printed plain).
 */
export function normaliseWebsiteUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 300 || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(v) || v.startsWith("//")) return null;
  // A scheme is `name:` that is not `host:port`.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/i.exec(v);
  let candidate = v;
  if (scheme) {
    if (!/^https?$/i.test(scheme[1]!)) return null;
    if (!/^https?:\/\//i.test(v)) return null;
    candidate = v.replace(/^http:\/\//i, "https://").replace(/^https:\/\//i, "https://");
  } else candidate = `https://${v}`;
  let u: URL;
  try { u = new URL(candidate); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || u.hostname.startsWith(".") || u.hostname.endsWith(".")) return null;
  return candidate;
}

export interface ContactPart { kind: "phone" | "email" | "website"; text: string; /** absolute https URL, website only, null when it must not be linked */ href: string | null }
export interface SalesContact { label: string; parts: ContactPart[]; /** The whole line as plain text: `Sales enquiries: <phone> · <email> · <website>`. */ text: string }

/** The sales enquiries line from the issuer's phone, email and website, exactly as stored. A missing part and its separator are omitted; null when all three are missing. */
export function salesContact(i: { phone?: string | null; email?: string | null; website?: string | null }): SalesContact | null {
  const clean = (v: string | null | undefined) => (v ?? "").trim();
  const parts: ContactPart[] = [];
  if (clean(i.phone)) parts.push({ kind: "phone", text: clean(i.phone), href: null });
  if (clean(i.email)) parts.push({ kind: "email", text: clean(i.email), href: null });
  if (clean(i.website)) parts.push({ kind: "website", text: clean(i.website), href: normaliseWebsiteUrl(i.website) });
  if (parts.length === 0) return null;
  return { label: SALES_ENQUIRIES_LABEL, parts, text: `${SALES_ENQUIRIES_LABEL} ${parts.map((p) => p.text).join(CONTACT_SEPARATOR)}` };
}

/** Address lines as stored: line breaks kept, each line trimmed, empty lines dropped. */
export function addressLines(address: string | null | undefined): string[] {
  return (address ?? "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}
