import "server-only";
import { jarvisLog } from "./log";
import { describeProtected, findProtectedContent, type ProtectedCategory } from "./protected";
import type { JarvisProvider, StructuredRequest } from "./provider/types";
import { ruleFor } from "./rulebook";
import { JarvisRefusalError } from "./types";

/**
 * THE OUTBOUND GATE: the one place a request can leave Enginious OS for the AI provider. Every action receives its provider already wrapped by this gate (the dispatcher does
 * it, so an action cannot obtain an ungated provider), and it applies the rulebook BEFORE the call:
 *   1. the capability must have a rulebook entry that approves a provider call (deny by default: no entry, no call);
 *   2. the request must declare its sources, and each must be one the entry approves (so a record field, a database row, the Map or an attachment cannot be added later
 *      without the rulebook changing);
 *   3. the whole outgoing text is screened for protected content (and the person's free text again, whatever earlier check ran); a hit, or a text that is too long to judge,
 *      is NOT sent: the person is asked for a version without those details.
 * There is no provider call that classifies intent: routing is done locally (lib/jarvis/router.ts). Nothing here logs text: only the capability id and category tokens.
 */
export const OUTBOUND_MAX_CHARS = 24_000;

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
      if (sources.length === 0 || sources.some((s) => !rule.outbound.sources.includes(s))) {
        jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: "source_not_approved" });
        throw new JarvisRefusalError("unavailable", "JARVIS cannot do that: it would send information that is not approved for the AI model.");
      }
      if (req.input.length > OUTBOUND_MAX_CHARS) {
        jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: "too_long" });
        throw new JarvisRefusalError("invalid_input", "That is too long for JARVIS to check safely. Send a shorter version.");
      }
      const found = findProtectedContent(req.input);
      if (found.length > 0) {
        for (const c of found) jarvisLog({ event: "outbound", actionId, outcome: "blocked", code: `protected_${c}` });
        throw outboundRefusal(found);
      }
      jarvisLog({ event: "outbound", actionId, outcome: "sent", providerKind: provider.kind });
      return provider.structured(req);
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
