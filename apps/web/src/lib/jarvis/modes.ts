/**
 * The things the JARVIS panel can be asked to do, as the PANEL names them (modes). Plain data shared by the browser and the server: no secrets, no logic about access.
 * A mode only chooses which registered action a typed message goes to; the server still resolves the action id in its deny-by-default registry, so a mode the person is
 * not allowed (or that is disabled) is refused whatever the browser sends.
 */
export type JarvisModeKey = "enquiry" | "reply" | "update" | "stage" | "meeting" | "organisation" | "help";

export interface JarvisMode {
  key: JarvisModeKey;
  actionId: string;
  label: string;
  placeholder: string;
  /** The mode works on ONE existing enquiry (the one the page shows, or one named by its reference). */
  needsEnquiry: boolean;
}

export const JARVIS_MODES: JarvisMode[] = [
  { key: "enquiry", actionId: "jarvis.sales.enquiry.create_from_brief", label: "New enquiry from a brief", placeholder: "Paste a WhatsApp message, an email or a rough brief…", needsEnquiry: false },
  { key: "reply", actionId: "jarvis.sales.draft_reply", label: "Draft a reply", placeholder: "Paste the client's message or the conversation to reply to…", needsEnquiry: true },
  { key: "update", actionId: "jarvis.sales.enquiry.update", label: "Update an enquiry", placeholder: "What should change? e.g. move the event to 12 December, venue is Harbour Hall", needsEnquiry: true },
  { key: "stage", actionId: "jarvis.sales.enquiry.change_stage", label: "Change status", placeholder: "Which stage? e.g. move to Qualified", needsEnquiry: true },
  { key: "meeting", actionId: "jarvis.sales.meeting.record", label: "Meeting notes", placeholder: "Paste your meeting notes: JARVIS proposes an activity and a follow-up…", needsEnquiry: true },
  { key: "organisation", actionId: "jarvis.sales.organisation.register", label: "Register a client or agency", placeholder: "The organisation's name, e.g. Fictional Harbour Brands", needsEnquiry: false },
  { key: "help", actionId: "jarvis.sales.help.answer", label: "Ask how something works", placeholder: "Ask a question about Enginious OS, e.g. How do I log a follow-up?", needsEnquiry: false },
];

export const modeByKey = (k: unknown): JarvisMode | null => JARVIS_MODES.find((m) => m.key === k) ?? null;
export const modeByAction = (id: string): JarvisMode | null => JARVIS_MODES.find((m) => m.actionId === id) ?? null;

/** An enquiry reference as the app writes it, e.g. OPP-UAE-2026-0001. */
export const ENQUIRY_REFERENCE = /\bOPP-[A-Z0-9]{2,8}-\d{4}-\d{3,6}\b/i;
