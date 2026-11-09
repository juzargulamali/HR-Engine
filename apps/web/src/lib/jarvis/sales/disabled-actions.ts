import "server-only";
import { z } from "zod";
import { registerJarvisAction } from "../registry";
import { JarvisRefusalError, type AnyJarvisAction } from "../types";

/**
 * The remaining Sales capabilities, REGISTERED BUT DISABLED in part 1: they show in the panel as "Not available yet" with the reason, and every call is refused. They are
 * implemented later, one at a time, as their own checks pass. Registering them now proves that the shared flow takes more actions without changes to the platform.
 */
const REASON = "Not available yet: it is built after enquiry creation has passed its checks.";
const defs: { id: string; title: string; description: string; risk: AnyJarvisAction["risk"] }[] = [
  { id: "jarvis.sales.email.draft_reply", title: "Draft a client email or reply", description: "A read-only draft for you to copy. JARVIS never sends anything.", risk: "draft" },
  { id: "jarvis.sales.help.ask", title: "Answer Enginious OS questions", description: "General how-to questions about the app.", risk: "read" },
  { id: "jarvis.sales.organisation.register", title: "Register a client or agency", description: "Add an organisation to Clients & Agencies.", risk: "write" },
  { id: "jarvis.sales.enquiry.update", title: "Update an enquiry", description: "Change details of an existing enquiry.", risk: "write" },
  { id: "jarvis.sales.enquiry.change_status", title: "Change an enquiry's status", description: "Move an enquiry to another stage.", risk: "write" },
  { id: "jarvis.sales.meeting.notes_to_activity", title: "Turn meeting notes into an activity and follow-up", description: "Log what was discussed and plan the next step.", risk: "write" },
];

export function registerDisabledSalesActions(): void {
  for (const d of defs) {
    registerJarvisAction({
      ...d, module: "sales", requires: { moduleGrant: "sales" }, status: { enabled: false, reason: REASON }, usesProvider: false,
      inputSchema: z.unknown(), valuesSchema: z.unknown(), describe: () => d.title,
      propose: async () => { throw new JarvisRefusalError("action_disabled", REASON); },
    } as AnyJarvisAction);
  }
}
