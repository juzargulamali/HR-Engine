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
  out.title = labelled(text, ["title", "subject", "requirement"]) ?? (free[0] && free[0].length <= 120 ? free[0] : null);
  const src = labelled(text, ["source"]);
  out.source = src ? (src.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")) : (SOURCE_WORDS.find(([re]) => re.test(text))?.[1] ?? null);
  out.agencyName = labelled(text, ["agency"]);
  out.clientName = labelled(text, ["client", "end client", "brand"]);
  const ev = labelled(text, ["event", "event date", "event dates", "show"]);
  const dates = ev?.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  out.eventStart = dates[0] ?? null;
  out.eventEnd = dates[1] ?? null;
  out.installStart = iso(labelled(text, ["installation", "install", "install date"]));
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
  const summary = free.slice(out.title && free[0] === out.title ? 1 : 0).join(" ").slice(0, 400);
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

export function createSimulatedProvider(): JarvisProvider {
  return {
    kind: "simulated",
    async structured(req: StructuredRequest): Promise<unknown> {
      simulatedProviderCalls.push({ ...req });
      if (req.input.includes("[[provider-timeout]]")) throw new JarvisProviderError("timeout");
      if (req.input.includes("[[provider-error]]")) throw new JarvisProviderError("http", 500);
      if (req.task === "reply_draft") return draftReply(req.input);
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
