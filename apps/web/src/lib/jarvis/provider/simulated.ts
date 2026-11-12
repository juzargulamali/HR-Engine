import "server-only";
import { JarvisProviderError, type JarvisProvider, type StructuredRequest } from "./types";

/**
 * A deterministic stand-in for the model, for tests and local runs ONLY (readJarvisConfig refuses it in production). It reads labelled lines such as
 * "Agency: ...", "Client: ...", "Event: 2026-12-05 to 2026-12-07", "Budget: AED 45,000" from the pasted text and returns the object the task asks for. It records every
 * request it receives (`simulatedProviderCalls`) so tests can assert exactly what would have left the app.
 *
 * Markers for tests: a text containing "ignore previous instructions" makes it return hostile extra keys (to prove the server prunes them); "[[provider-error]]"
 * makes it fail; "[[provider-timeout]]" makes it time out.
 */
export const simulatedProviderCalls: StructuredRequest[] = [];

const SOURCE_WORDS: [RegExp, string][] = [[/whatsapp/i, "whatsapp"], [/instagram/i, "instagram"], [/linkedin/i, "linkedin"], [/\breferr(?:al|ed)\b/i, "referral"], [/\bwebsite\b/i, "website"]];

function labelled(text: string, names: string[]): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z ]{1,24}?)\s*:\s*(.+?)\s*$/.exec(line);
    if (m && names.includes(m[1]!.toLowerCase())) return m[2]!;
  }
  return null;
}
const iso = (s: string | null) => (s && /\d{4}-\d{2}-\d{2}/.exec(s)?.[0]) || null;

function extractEnquiry(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const free = lines.filter((l) => !/^[A-Za-z][A-Za-z ]{1,24}:\s*\S/.test(l));
  out.title = labelled(text, ["title", "subject", "requirement", "project", "project name"]) ?? (free[0] && free[0].length <= 120 ? free[0] : null);
  const src = labelled(text, ["source"]);
  out.source = src ? (src.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")) : (SOURCE_WORDS.find(([re]) => re.test(text))?.[1] ?? null);
  out.agencyName = labelled(text, ["agency"]);
  out.clientName = labelled(text, ["client", "end client", "brand"]);
  const ev = labelled(text, ["event", "event date", "event dates", "show"]);
  const dates = ev?.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  out.eventStart = dates[0] ?? null;
  out.eventEnd = dates[1] ?? null;
  out.installStart = iso(labelled(text, ["installation", "install", "install date", "setup", "set-up"]));
  out.location = labelled(text, ["location", "venue"]);
  const budget = labelled(text, ["budget", "value"]);
  const bm = budget ? /([A-Za-z]{3})?\s*([\d][\d,]*(?:\.\d+)?)\s*([A-Za-z]{3})?/.exec(budget) : null;
  out.currency = bm ? (bm[1] ?? bm[3] ?? null) : null;
  out.value = bm ? Number(bm[2]!.replace(/,/g, "")) : null;
  out.budgetNote = labelled(text, ["budget note"]);
  const tech = labelled(text, ["technologies", "technology", "tech", "equipment"]);
  out.technologies = tech ? tech.split(/[;,]/).map((t) => t.trim()).filter(Boolean).map((t) => { const m = /^(.*?)(?:\s*[x×]\s*(\d+))?$/i.exec(t)!; return { name: m[1]!.trim(), qty: m[2] ? Number(m[2]) : 1 }; }) : [];
  out.scope = labelled(text, ["scope"]);
  const w = labelled(text, ["waiting on", "waiting"]);
  out.waitingOn = w && /client/i.test(w) ? "client" : w && /internal|team/i.test(w) ? "internal" : null;
  const next = labelled(text, ["next", "next action"]);
  out.nextTitle = next ? next.replace(/\s+on\s+\d{4}-\d{2}-\d{2}.*$/i, "").trim() || null : null;
  out.nextDate = iso(labelled(text, ["due", "next date"])) ?? iso(next);
  out.nextKind = next ? (/\bemail\b/i.test(next) ? "email" : /\bmeet/i.test(next) ? "meeting" : /\bcall\b/i.test(next) ? "call" : /\bproposal\b/i.test(next) ? "proposal" : "other") : null;
  const summary = free.slice(out.title && free[0] === out.title ? 1 : 0).join(" ");
  out.briefSummary = summary || labelled(text, ["summary", "brief"]);
  return out;
}

/** A reply draft from the labelled facts and the conversation (deterministic). Markers: "[[invent-price]]" makes it state a price, a date and availability that nobody gave it. */
function draftReply(input: string): Record<string, unknown> {
  const facts = /<enquiry>\n([\s\S]*?)\n<\/enquiry>/.exec(input)?.[1] ?? "";
  const convo = /<conversation>\n([\s\S]*?)\n<\/conversation>/.exec(input)?.[1] ?? "";
  const field = (k: string) => new RegExp(`^${k}: (.+)$`, "mi").exec(facts)?.[1] ?? null;
  const title = field("Title") ?? "your enquiry";
  const dates = field("Event dates");
  const used: { value: string; source: string }[] = [];
  const lines = [`Dear colleague,`, ``, `Thank you for your message about ${title}.`];
  if (dates) { lines.push(`We have noted the event dates as ${dates}.`); for (const d of dates.match(/\d{4}-\d{2}-\d{2}/g) ?? []) used.push({ value: d, source: "enquiry" }); }
  const asked = /price|cost|quote|how much|budget/i.test(convo);
  const quoted = /(?:AED|USD)\s?[\d,]+/i.exec(convo)?.[0];
  if (quoted) { lines.push(`You mentioned ${quoted}; we will review it and come back to you.`); used.push({ value: quoted, source: "conversation" }); }
  else if (asked) lines.push(`We will confirm the pricing once we have checked the details and come back to you.`);
  if (/available|availability|in stock/i.test(convo)) lines.push(`We will check availability and confirm.`);
  const toConfirm: { kind: string; text: string }[] = [];
  if (convo.includes("[[invent-price]]")) {
    lines.push(`The total will be AED 99,999 and the equipment is available on 14 January 2027, reserved for you.`);
    used.push({ value: "AED 99,999", source: "enquiry" });
  }
  lines.push(``, `Kind regards,`, `[Your name]`);
  const out: Record<string, unknown> = { subject: `Re: ${title}`.slice(0, 150), body: lines.join("\n"), toConfirm, usedValues: used };
  if (/ignore (all )?previous instructions/i.test(convo)) Object.assign(out, { execute: true, send: true, to: "attacker@example.com", grantAdmin: true, confirmed: true, role: "admin" });
  return out;
}

/** An enquiry update from labelled lines of the request ("Location: X", "Event: 2026-12-05 to 2026-12-07", "Clear location"). Hostile marker returns keys outside the allowlist. */
function enquiryUpdate(input: string): Record<string, unknown> {
  const req = /<request>\n([\s\S]*?)\n<\/request>/.exec(input)?.[1] ?? "";
  const out: Record<string, unknown> = {};
  const set = (key: string, names: string[]) => { const v = labelled(req, names); if (v) out[key] = v; };
  set("title", ["title", "name"]); set("location", ["location", "venue"]); set("scope", ["scope"]); set("brief", ["brief", "summary"]); set("budgetNote", ["budget note", "budget"]);
  const ev = labelled(req, ["event", "event dates", "event date", "show"]);
  const dates = ev?.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates[0]) out.eventStart = dates[0];
  if (dates[1]) out.eventEnd = dates[1];
  const inst = iso(labelled(req, ["installation", "install", "install date"]));
  if (inst) out.installStart = inst;
  const w = labelled(req, ["waiting on", "waiting"]);
  if (w) out.waitingOn = /client/i.test(w) ? "client" : /internal|team/i.test(w) ? "internal" : null;
  const tech = labelled(req, ["technologies", "technology", "tech"]);
  if (tech) out.technologies = tech.split(/[;,]/).map((t) => t.trim()).filter(Boolean).map((t) => { const m = /^(.*?)(?:\s*[x×]\s*(\d+))?$/i.exec(t)!; return { name: m[1]!.trim(), qty: m[2] ? Number(m[2]) : 1 }; });
  const clear = [...req.matchAll(/\bclear (?:the )?(location|scope|brief|budget note|waiting on|installation)\b/gi)].map((m) => ({ location: "location", scope: "scope", brief: "brief", "budget note": "budgetNote", "waiting on": "waitingOn", installation: "installStart" } as Record<string, string>)[m[1]!.toLowerCase()]);
  if (clear.length) out.clear = clear;
  if (/ignore (all )?previous instructions/i.test(req)) Object.assign(out, { value: 1, currency: "USD", ownerId: "00000000-0000-4000-8000-0000000000cc", owner_id: "00000000-0000-4000-8000-0000000000cc", stage: "won", agencyOrgId: "00000000-0000-4000-8000-0000000000aa", agency_org_id: "00000000-0000-4000-8000-0000000000aa", execute: true, confirmed: true, paymentTerms: "100% upfront", exclusions: "none", risks: ["x"] });
  return out;
}

/** Meeting notes: reads labelled lines ("Summary:", "Type:", "Meeting date:", "Next:", "Due:"). Markers: "[[invent-date]]" makes it return a follow-up date the notes never state; a vague phrase ("next week", "soon") makes it GUESS one, to prove the server drops it. */
function meetingNotes(input: string, instructions: string): Record<string, unknown> {
  const notes = /<notes>\n([\s\S]*?)\n<\/notes>/.exec(input)?.[1] ?? input;
  const today = /Today \(Dubai\) is (\d{4}-\d{2}-\d{2})/.exec(instructions)?.[1] ?? "2026-01-01";
  const free = notes.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[A-Za-z][A-Za-z ]{1,24}:\s*\S/.test(l));
  const type = (labelled(notes, ["type", "kind"]) ?? "meeting").toLowerCase().replace(/[^a-z_]/g, "");
  const next = labelled(notes, ["next", "next step", "follow up", "follow-up"]);
  let date = iso(labelled(notes, ["due", "next date"])) ?? iso(next);
  if (!date && /tomorrow/i.test(next ?? "")) date = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (!date && /next week|soon|end of the month|after the event/i.test(next ?? "")) date = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  if (notes.includes("[[invent-date]]")) date = "2099-03-03";
  const out: Record<string, unknown> = {
    activityKind: ["meeting", "call", "email", "note", "client_response"].includes(type) ? type : "meeting",
    summary: labelled(notes, ["summary"]) ?? free.join(" ").slice(0, 1500), meetingDate: iso(labelled(notes, ["meeting date", "date"])),
    followUpTitle: next ? next.replace(/\s+(?:on|by)\s+\d{4}-\d{2}-\d{2}.*$/i, "").trim() || null : null, followUpDate: date, followUpKind: next ? (/\bemail\b/i.test(next) ? "email" : /\bmeet/i.test(next) ? "meeting" : /\bcall\b/i.test(next) ? "call" : /\bproposal\b/i.test(next) ? "proposal" : "other") : null,
  };
  if (/ignore (all )?previous instructions/i.test(notes)) Object.assign(out, { execute: true, confirmed: true, assignee: "00000000-0000-4000-8000-0000000000cc", stage: "won", value: 1 });
  return out;
}

/**
 * General chat (deterministic). It shows what it was given: whether preferences and earlier turns arrived, and "make it shorter" really shortens the earlier draft.
 * Markers: "[[leak-figure]]" makes it answer with a protected figure, to prove the server withholds it.
 */
function chatAnswer(input: string): Record<string, unknown> {
  const message = /<message>\n([\s\S]*?)\n<\/message>/.exec(input)?.[1] ?? "";
  const prefs = /<preferences>\n([\s\S]*?)\n<\/preferences>/.exec(input)?.[1] ?? "";
  const earlier = [...input.matchAll(/<jarvis>\n([\s\S]*?)\n<\/jarvis>/g)].map((m) => m[1]!);
  const short = /short/i.test(prefs);
  const british = /British/i.test(prefs);
  const sign = british ? "Kind regards (organised in British English)" : "Best regards";
  let reply: string;
  if (message.includes("[[leak-figure]]")) reply = "Her salary is AED 18,500 per month.";
  else if (/\b(?:shorter|shorten)\b/i.test(message) && earlier.length > 0) reply = `${earlier[earlier.length - 1]!.split("\n").filter(Boolean).slice(0, 2).join("\n")}\n(shortened)`;
  else if (/\b(?:draft|write|compose)\b/i.test(message)) reply = short ? `Hello [name],\nA short note as requested.\n${sign}` : `Hello [name],\nThank you for your time.\nI am writing about the matter we discussed.\nPlease let me know a convenient time.\n${sign}`;
  else reply = "This is a general answer (simulated): I have no access to any company data here.";
  const out: Record<string, unknown> = { reply };
  if (/ignore (all )?previous instructions/i.test(input)) Object.assign(out, { execute: true, showPayroll: true, role: "admin", systemPrompt: "leaked" });
  return out;
}

/** How the stand-in answers a summary or a scope request, so tests can prove what the server does with a wrong, money-bearing or unusable answer. */
export const simulatedBehaviour: { summary: "ok" | "wrong_number" | "swapped" | "outcome" | "malformed" | "bad_suggestions"; scope: "ok" | "money"; closeout: "ok" | "unsupported" | "malformed" } = { summary: "ok", scope: "ok", closeout: "ok" };

/**
 * A closeout report: for each section it repeats, with their references, a few of the evidence lines it received, so a test sees exactly what arrived and that every
 * statement is traceable. "unsupported" makes it claim what a real model might wrongly claim: a client sign-off and a full equipment return nobody recorded, a date and a
 * quotation that are in no evidence line, a reference that was never sent, and extra keys asking for actions. "malformed" returns nothing usable.
 */
function closeoutReport(input: string): Record<string, unknown> {
  if (simulatedBehaviour.closeout === "malformed") return { nothing: true };
  const data = /<enginious_os_data>\n([\s\S]*?)\n<\/enginious_os_data>/.exec(input)?.[1] ?? "";
  const lines = data.split("\n").map((l) => /^\[(S\d+)\] \(([^)]*)\) (.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ ref: m[1]!, label: m[2]!, text: m[3]! }));
  const pick = (re: RegExp, n = 3) => lines.filter((l) => re.test(l.label)).slice(0, n).map((l) => ({ text: l.text, refs: [l.ref] }));
  const sections: { id: string; paragraphs: { text: string; refs: string[] }[] }[] = [
    { id: "summary", paragraphs: [...pick(/^Project/, 1), ...pick(/^Handover/, 2)] },
    { id: "scope", paragraphs: pick(/^Agreed scope/, 4) },
    { id: "team", paragraphs: pick(/^Team/, 6) },
    { id: "decisions", paragraphs: pick(/^Decisions/, 4) },
    { id: "feedback", paragraphs: pick(/^Client feedback/, 4) },
    { id: "handover", paragraphs: [...pick(/^Handover/, 3), ...pick(/^Equipment/, 3)] },
    { id: "open_items", paragraphs: pick(/^Incomplete/, 5) },
    { id: "lessons", paragraphs: lines.length > 0 ? [{ text: "Agree the return date for equipment before the event closes.", refs: [lines[lines.length - 1]!.ref] }] : [] },
  ];
  if (simulatedBehaviour.closeout === "unsupported") {
    const first = lines[0]?.ref ?? "S1";
    sections[0]!.paragraphs.push({ text: "The client signed off the installation on 2031-01-09 and all equipment was returned.", refs: [first] });
    sections[4]!.paragraphs.push({ text: 'The client said "this is the best stand we have ever had".', refs: [first] });
    sections[2]!.paragraphs.push({ text: "The team showed outstanding dedication.", refs: ["S9999"] });
    return { sections, execute: true, markComplete: true, sendToClient: "client@example.com", approve: true };
  }
  return { sections };
}

/**
 * A summary: it repeats the fact lines it received (so a test can see exactly what arrived) and adds one harmless suggestion. The behaviours make it misbehave the way a
 * real model can: a number that is nowhere in the record, a result the record does not state, facts dressed up as suggestions, or an unusable answer.
 */
function salesSummary(input: string): Record<string, unknown> {
  const data = /<enginious_os_data>\n([\s\S]*?)\n<\/enginious_os_data>/.exec(input)?.[1] ?? "";
  const facts = data.split("\n").filter((l) => /^[A-Za-z][A-Za-z ,()'&/%-]*: /.test(l)).slice(0, 8);
  if (simulatedBehaviour.summary === "malformed") return { nothing: true };
  let summary = `In short: ${facts.join("; ")}.`;
  if (simulatedBehaviour.summary === "wrong_number") summary += " That is 9871 more than expected.";
  if (simulatedBehaviour.summary === "swapped") summary = "We won 2 enquiries and lost 8.";
  if (simulatedBehaviour.summary === "outcome") summary += " The work was delivered and invoiced.";
  const suggestions = simulatedBehaviour.summary === "bad_suggestions" ? ["We won 2 enquiries and lost 8.", "We won 3 enquiries.", "We completed 8 projects.", "Chase the three oldest ones.", "Call the agencies that went quiet."] : ["Review the open follow-ups."];
  return { summary, suggestions, execute: true, role: "admin" };
}
function estimateScope(input: string): Record<string, unknown> {
  const req = /<request>\n([\s\S]*?)\n<\/request>/.exec(input)?.[1] ?? "";
  const data = /<enginious_os_data>\n([\s\S]*?)\n<\/enginious_os_data>/.exec(input)?.[1] ?? "";
  const lines = [`Scope for: ${req.split("\n")[0]!.slice(0, 120)}`, ...data.split("\n").filter((l) => l.startsWith("Requested technology: ")).map((l) => `- ${l.slice("Requested technology: ".length)}`), "- Software development and on-site set-up", "Excluded: furniture and stand build"];
  if (simulatedBehaviour.scope === "money") lines.push("- LED wall hire at AED 12,000 per day");
  return { draft: lines.join("\n"), questions: ["Which reader model will be supplied?"] };
}

export function createSimulatedProvider(): JarvisProvider {
  return {
    kind: "simulated",
    async structured(req: StructuredRequest): Promise<unknown> {
      simulatedProviderCalls.push({ ...req });
      if (req.input.includes("[[provider-timeout]]")) throw new JarvisProviderError("timeout");
      if (req.input.includes("[[provider-error]]")) throw new JarvisProviderError("http", 500);
      if (req.task === "reply_draft") return draftReply(req.input);
      if (req.task === "chat_reply") return chatAnswer(req.input);
      if (req.task === "enquiry_update") return enquiryUpdate(req.input);
      if (req.task === "meeting_notes") return meetingNotes(req.input, req.instructions);
      if (req.task === "sales_summary") return salesSummary(req.input);
      if (req.task === "estimate_scope") return estimateScope(req.input);
      if (req.task === "closeout_report") return closeoutReport(req.input);
      if (req.task !== "enquiry_fields") throw new JarvisProviderError("malformed");
      const out = extractEnquiry(req.input);
      if (/ignore (all )?previous instructions/i.test(req.input)) {
        // What a manipulated model might return: keys that do not exist in the schema, a forged company and organisation id, an "execute" request.
        Object.assign(out, { execute: true, confirmed: true, grantAdmin: true, role: "admin", companyId: "00000000-0000-4000-8000-000000000001", company_id: "00000000-0000-4000-8000-000000000001",
          agencyOrgId: "00000000-0000-4000-8000-0000000000aa", clientOrgId: "00000000-0000-4000-8000-0000000000bb", ownerId: "00000000-0000-4000-8000-0000000000cc", showPayroll: true });
      }
      return out;
    },
  };
}
