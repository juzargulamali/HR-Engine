import "server-only";
import { jarvisLog } from "./log";
import { RESTRICTED_TEXT_MESSAGE } from "./outbound-messages";
import { describeProtected, findProtectedContent, wholeTextRestricted, type ProtectedCategory } from "./protected";
import type { JarvisProvider, StructuredRequest } from "./provider/types";
import { ruleFor } from "./rulebook";
import { JarvisRefusalError } from "./types";

/**
 * THE OUTBOUND GATE: the one place a request can leave Enginious OS for the AI provider. Every action receives its provider already wrapped by this gate (the dispatcher does
 * it, so an action cannot obtain an ungated provider), and it applies the rulebook BEFORE the call:
 *   1. the capability must have a rulebook entry that approves a provider call (deny by default: no entry, no call);
 *   2. the request must declare its sources, and each must be one the entry approves;
 *   3. app-held data is structural: what the person supplied is in `input`; what Enginious OS holds can only be in `facts` (fact lines with a fixed, non-financial
 *      label and a value that is a whole-number count, a date, a name or a title) and `recordText` (free text of a record), each needing its own approved source. A request
 *      that declares an app source without the field (or the field without the source) is refused. A stored structured financial field has no way in: no projection
 *      selects one, a label that names money is refused, and a number is accepted only as a count;
 *   4. a text marked as not for external sharing ("External sharing prohibited", "Internal use only", "NDA") is refused outright, for every capability and every part;
 *   5. everything is screened for protected content (pay, personal IDs, medical and bank details, credentials, company results, estimate documents, embedded files):
 *      the person's text, every fact value and every line of record text. A financial figure in the person's text or in a stored note or description is NOT protected
 *      content (owner policy). A hit, or a request too long to judge, is NOT sent. The provider is never asked to redact anything.
 * There is no provider call that classifies intent: routing is done locally (lib/jarvis/router.ts). Nothing here logs text: only the capability id and category tokens.
 */
export const OUTBOUND_MAX_CHARS = 24_000;
/** A fact label is fixed wording written in the code: letters, spaces and a little punctuation. No digits (a figure belongs in the value), no markup. */
/** A fact line never carries a structured financial field: a label that names money is refused whatever its value. */
const MONEY_LABEL = /\b(?:value|valued|worth|budget|price|pricing|cost|rate|fee|amount|total|payment|paid|deposit|margin|mark-?up|discount|estimate|quote|quotation|invoice|revenue|turnover|profit|tax|vat|currency)\b/i;
const FACT_LABEL = /^[A-Za-z][A-Za-z ,()'&/%-]{0,79}$/;

export function outboundRefusal(categories: readonly ProtectedCategory[]): JarvisRefusalError {
  return new JarvisRefusalError(
    "protected_content",
    `I did not send that to the AI model because it seems to contain ${describeProtected(categories)}. JARVIS keeps those inside Enginious OS. Remove those details and try again, or use the relevant screen in Enginious OS.`,
  );
}

export function gateProvider(provider: JarvisProvider | null, actionId: string): JarvisProvider | null {
  if (!provider) return null;
  return {
    kind: provider.kind,
    async structured(req: StructuredRequest): Promise<unknown> {
      const rule = ruleFor(actionId);
      if (!rule || !rule.outbound.provider) {
        jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: "capability_not_approved" });
        throw new JarvisRefusalError("unavailable", "JARVIS cannot do that: it is not an approved use of the AI model.");
      }
      const sources = req.sources ?? [];
      const block = (code: string, e: JarvisRefusalError): never => { jarvisLog({ event: "outbound", actionId, outcome: "blocked", code }); throw e; };
      const notApproved = () => block("source_not_approved", new JarvisRefusalError("unavailable", "JARVIS cannot do that: it would send information that is not approved for the AI model."));
      if (sources.length === 0 || sources.some((s) => !rule.outbound.sources.includes(s))) notApproved();
      // App-held data travels only in its own fields, and only with its own approved source. Neither can stand in for the other.
      const facts = req.facts ?? [];
      const recordText = (req.recordText ?? "").trim();
      if ((facts.length > 0) !== sources.includes("sales_facts") || (recordText.length > 0) !== sources.includes("sales_record_text")) notApproved();
      if ((facts.length > 0 || recordText) && req.inputTag !== null) notApproved();
      const factLines: string[] = [];
      for (const f of facts) {
        // A label is fixed wording from the code; a value is a whole number (a count or a share), a date, a name or a screened title. Anything else is refused.
        if (typeof f?.label !== "string" || !FACT_LABEL.test(f.label) || MONEY_LABEL.test(f.label)) notApproved();
        if (typeof f.value === "number" ? !Number.isInteger(f.value) || Math.abs(f.value) > 1_000_000 : typeof f.value !== "string" || f.value.length > 400 || /[<>]/.test(f.value)) notApproved();
        factLines.push(`${f.label}: ${f.value}`);
      }
      const app = [factLines.join("\n"), recordText].filter(Boolean).join("\n");
      if (req.input.length + app.length > OUTBOUND_MAX_CHARS) block("too_long", new JarvisRefusalError("invalid_input", "That is too long for JARVIS to check safely. Send a shorter version."));
      // A sharing restriction on the text is absolute and is checked HERE, for every capability: whatever mode was chosen, whatever was edited, and whether the marking
      // sits in the message, in the earlier context or in a record, a text marked as not for external sharing makes no provider call.
      if (wholeTextRestricted(req.input) || (recordText && wholeTextRestricted(recordText)) || facts.some((f) => typeof f.value === "string" && wholeTextRestricted(f.value))) {
        block("sharing_restricted", new JarvisRefusalError("protected_content", `${RESTRICTED_TEXT_MESSAGE} Continue in Enginious OS yourself (for an enquiry, use the new-enquiry form).`));
      }
      const found = findProtectedContent(req.input);
      if (found.length > 0) {
        for (const c of found) jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: `protected_${c}` });
        throw outboundRefusal(found);
      }
      // The app-held parts: each fact value and the record text, under the same content rule (a figure in a stored note is allowed; protected material is not).
      const appFound = new Set<ProtectedCategory>();
      for (const f of facts) if (typeof f.value === "string") for (const c of findProtectedContent(f.value)) appFound.add(c);
      if (recordText) for (const c of findProtectedContent(recordText)) appFound.add(c);
      if (appFound.size > 0) {
        for (const c of appFound) jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: `app_${c}` });
        throw new JarvisRefusalError("protected_content", "I did not send that to the AI model: a record it would have used contains details that stay inside Enginious OS. Open the record in Enginious OS instead.");
      }
      jarvisLog({ event: "outbound", actionId, outcome: "sent", providerKind: provider.kind });
      const { facts: _f, recordText: _r, ...rest } = req;
      return provider.structured({ ...rest, input: app ? `${req.input}\n<enginious_os_data>\n${app}\n</enginious_os_data>` : req.input });
    },
  };
}

/** What a model answer must pass before it is shown: no protected details. Returns the categories found (empty = it may be shown). */
export function screenResponse(text: string, actionId: string): ProtectedCategory[] {
  const found = findProtectedContent(text);
  for (const c of found) jarvisLog({ event: "outbound", actionId, outcome: "response_withheld", code: `protected_${c}` });
  return found;
}

/** A free-text field of a record, before a lookup displays it: protected details are replaced, never shown. */
export function displaySafe(text: string | null | undefined, max = 160): { text: string; hidden: boolean } {
  const t = (text ?? "").trim().slice(0, max);
  if (t && findProtectedContent(t).length > 0) return { text: "Details hidden here. Open the record to see them.", hidden: true };
  return { text: t, hidden: false };
}
