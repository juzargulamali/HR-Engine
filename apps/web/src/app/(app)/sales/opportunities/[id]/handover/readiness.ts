/**
 * What a Sales-to-Projects handover carries, and what it does not. Pure (no database, no React), so the page and its tests state the same facts.
 *
 * Every line is read from the database functions, not assumed:
 *   - proj_save_handover (20261120000200_proj_projects_handover_functions.sql) writes the brief: title, client, location, site time zone, installation date, show dates,
 *     technologies, scope, exclusions, risks and notes. Nothing commercial is read.
 *   - proj_submit_handover refuses a brief whose scope is blank, and tells the people who name the Project Manager (or the Project Manager on a resubmission).
 *   - proj_accept_handover creates the project from the brief: name, Project Manager, start and end dates on the project; client, location, site time zone, installation
 *     date, show dates, scope, exclusions, technologies and risks on its details. The NOTES are not in that insert: they stay on the brief.
 *   - 20270102000100_ops_phase2b.sql section 4 copies the enquiry's event edition onto the brief while it is prepared and again when it is submitted, and from the brief
 *     onto the project when it is created.
 *   - No function copies contacts, proposals, estimates, files, the value, payment terms or the purchase order.
 */

export interface ReadinessBrief {
  title: string; clientName: string; location: string; siteTimezone: string; installStart: string; eventStart: string; eventEnd: string;
  scope: string; exclusions: string; notes: string; technologies: readonly { name: string; qty: number }[]; risks?: readonly string[];
}

export interface TransferLine { key: string; label: string; value: string; missing: boolean }
export type AttentionKind = "blocker" | "check" | "not_copied";
export interface AttentionLine { key: string; kind: AttentionKind; text: string }
export interface Readiness { ready: boolean; transfers: TransferLine[]; attention: AttentionLine[] }

export const ATTENTION_WORDS: Record<AttentionKind, string> = { blocker: "Blocks submitting", check: "Check", not_copied: "Not copied" };

const short = (s: string, max = 90) => { const t = s.trim().replace(/\s+/g, " "); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `brief` is the saved brief, or the enquiry's facts when none is saved yet (`saved` false). `edition` is the linked event edition's name, or null when there is none.
 * `contactCount` is null when the contacts could not be read: the line then says so, never "no contacts". `salesGaps` are the enquiry's own open points (they do not
 * block submitting). `formatDate` words a YYYY-MM-DD date.
 */
export function handoverReadiness(a: {
  brief: ReadinessBrief; saved: boolean; edition: string | null; contactCount: number | null; salesGaps?: readonly string[]; formatDate: (d: string) => string;
}): Readiness {
  const b = a.brief;
  const has = (s: string | null | undefined) => !!s && s.trim() !== "";
  const line = (key: string, label: string, value: string | null, emptyWords: string): TransferLine => ({ key, label, value: value ?? emptyWords, missing: value === null });
  const techs = b.technologies.filter((t) => has(t.name));
  const risks = (b.risks ?? []).filter((r) => has(r));
  const show = has(b.eventStart) ? (has(b.eventEnd) && b.eventEnd !== b.eventStart ? `${a.formatDate(b.eventStart)} to ${a.formatDate(b.eventEnd)}` : a.formatDate(b.eventStart)) : null;

  const transfers: TransferLine[] = [
    line("title", "Project name", has(b.title) ? short(b.title) : null, "Not given"),
    line("scope", "Scope of work", has(b.scope) ? short(b.scope) : null, "Not written yet"),
    line("exclusions", "Exclusions", has(b.exclusions) ? short(b.exclusions) : null, "None recorded"),
    // A new brief left blank takes the client or agency name from the enquiry when it is saved (proj_save_handover).
    line("client", "Client", has(b.clientName) ? short(b.clientName) : a.saved ? null : "The client or agency on the enquiry", "Not given"),
    line("location", "Location", has(b.location) ? short(b.location) : null, "Not given"),
    line("install", "Installation date", has(b.installStart) ? a.formatDate(b.installStart) : null, "Not set"),
    line("show", "Show dates", show, "Not set"),
    line("timezone", "Site time zone", has(b.siteTimezone) ? b.siteTimezone : null, "Not set"),
    line("technologies", "Technologies and quantities", techs.length > 0 ? short(techs.map((t) => `${t.name} × ${t.qty}`).join(", ")) : null, "None listed"),
    line("risks", "Risks", risks.length > 0 ? plural(risks.length, "risk") : null, "None recorded"),
    ...(a.edition ? [line("edition", "Event edition", `${short(a.edition)} (copied as it stands when you submit)`, "")] : []),
  ];

  const attention: AttentionLine[] = [];
  const blocked = !has(b.scope);
  if (blocked) attention.push({ key: "scope", kind: "blocker", text: "The scope of work is empty. Write what was agreed to deliver: the handover cannot be submitted without it." });
  if (!has(b.installStart) && !has(b.eventStart)) attention.push({ key: "dates", kind: "check", text: "No installation or show date is in the brief, so the project starts without dates." });
  if (!has(b.location)) attention.push({ key: "location", kind: "check", text: "No location is in the brief." });
  if (techs.length === 0) attention.push({ key: "technologies", kind: "check", text: "No technologies are listed, so the Project Manager has nothing to bring into the Project Plan." });
  for (const [i, g] of (a.salesGaps ?? []).entries()) attention.push({ key: `gap-${i}`, kind: "check", text: `On the enquiry: ${g}` });

  attention.push({
    key: "contacts", kind: "not_copied",
    text: a.contactCount === null
      ? "Contacts are not copied to the project. The enquiry's contacts could not be loaded just now, so their number is not shown."
      : a.contactCount === 0
        ? "Contacts are not copied to the project, and this enquiry has none linked. Put the site contact in the notes for the Project Manager."
        : `Contacts are not copied: the ${plural(a.contactCount, "contact")} and their roles stay on the enquiry. The Project Manager opens them from the enquiry link, which needs Sales access, so put the site contact in the notes.`,
  });
  attention.push({ key: "notes", kind: "not_copied", text: "Notes for the Project Manager stay on this brief. The Project Manager reads them under Projects, Handovers; they are not copied onto the project itself." });
  attention.push({ key: "commercial", kind: "not_copied", text: "The value, payment terms, purchase order or authorised email, proposals, estimates and files stay in Sales & CRM. The project never shows them." });
  if (techs.length > 0) attention.push({ key: "plan", kind: "not_copied", text: "Technologies are copied as a list. They become Project Plan rows only when the Project Manager brings them in after accepting." });

  return { ready: !blocked, transfers, attention };
}

/** Who is told when the brief is submitted, in words (proj_submit_handover and the Operations trigger of 20270102000100_ops_phase2b.sql). */
export const SUBMIT_TELLS = "Founders, Operations Managers and anyone who can assign Project Managers in this company get a notification in the app, and the handover appears under Projects, Handovers. One of them names the Project Manager, who accepts it: that creates the project. Nothing is sent to the client.";
export const RESUBMIT_TELLS = "The Project Manager gets a notification in the app that you have answered, and can then accept it. Nothing is sent to the client.";
/** proj_withdraw_handover: no notification, the reason is appended to the notes, and a new brief can be prepared afterwards. An accepted handover cannot be withdrawn. */
export const WITHDRAW_CONSEQUENCE = "Withdrawing takes this handover off the Projects list, so nobody can accept it and no project is created from it. Nobody is notified: tell the Project Manager yourself if one was named. The reason is added to the brief's notes, and you can prepare a new handover for this enquiry afterwards.";
