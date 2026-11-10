/**
 * THE ENGINIOUS OS RULEBOOK FOR JARVIS, as data the server enforces. The words for people are in docs/enginious-os/modules/jarvis-rulebook.md; a test keeps the two in step
 * (every id below is in the document, every registered action has an entry here, and nothing without an entry can reach the provider).
 *
 * For every capability: who may use it, which company and records it may touch, what JARVIS may display, what may go to the AI provider (Anthropic), whether it needs a
 * confirmation, and which switch pauses it. DENY BY DEFAULT: a capability, a field or an outbound source that is not written here is not approved.
 *
 * Permission is never taken from the model, a prompt, memory or an earlier answer: every request (and every follow-up) is authorised again from the signed-in session, and the
 * records are read through that person's own session, so the database's own rules (company and record scope) decide what exists for them.
 */

/** The independent pause switches. `jarvis` and `writes` already existed (jarvis_settings.enabled / writes_enabled); the others are added by migration 20261226000100. */
export type JarvisSwitch = "jarvis" | "writes" | "help" | "lookups" | "chat" | "memory";

/**
 * What a provider request may be built from. A request DECLARES its sources and the gate refuses any that the capability does not approve.
 *   user_text             what the person typed or pasted in THIS message (screened for protected content first)
 *   conversation_context  the last few turns of the current general conversation, as the browser holds them (bounded, screened again on every call; never stored)
 *   preferences           fixed sentences chosen by the person's saved, structured preferences (never free text)
 *   enquiry_reply_facts   the reply-relevant facts of ONE enquiry the person can see (reference, title, parties, dates, place, technologies, scope, brief summary)
 *   enquiry_update_fields the current values of the ten updatable fields of ONE enquiry the person can see
 */
export type OutboundSource = "user_text" | "conversation_context" | "preferences" | "enquiry_reply_facts" | "enquiry_update_fields";

export interface JarvisRule {
  id: string;
  title: string;
  kind: "conversation" | "knowledge" | "lookup" | "draft" | "write" | "memory" | "guide";
  /** Who may use it (beyond: signed in, JARVIS switched on, on the pilot list, the company allowed). */
  who: string;
  /** Which company and records it may touch. */
  scope: string;
  /** What JARVIS may display. Anything else is not shown. */
  display: string[];
  /** What may go to Anthropic. `provider: false` = no provider call exists for this capability and the gate refuses one. */
  outbound: { provider: boolean; sources: OutboundSource[]; note: string };
  confirmation: "none" | "review_card" | "review_card_and_acknowledgement";
  /** Any of these switches being off pauses the capability. */
  pausedBy: JarvisSwitch[];
}

const SALES = "An active Sales & CRM grant for the selected company";
const NO_PROVIDER = { provider: false, sources: [] as OutboundSource[], note: "Nothing. No provider call is made." };

export const JARVIS_RULES: JarvisRule[] = [
  {
    id: "jarvis.local.conversation", title: "Greetings, thanks and short clarifying questions", kind: "conversation",
    who: "Anyone who may open JARVIS", scope: "No company data and no records",
    display: ["fixed sentences written in the app"], outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis"],
  },
  {
    id: "jarvis.sales.chat.reply", title: "General questions and writing help (drafts to copy)", kind: "conversation",
    who: SALES, scope: "No records are read. Only the person's own message, the last few turns of the same conversation and their own saved preferences",
    display: ["the model's answer or draft (screened for protected details before it is shown)", "which saved preferences were applied"],
    outbound: { provider: true, sources: ["user_text", "conversation_context", "preferences"], note: "The message, at most four earlier turns of the same conversation and fixed preference sentences. Never records, the Map, attachments or other people's data." },
    confirmation: "none", pausedBy: ["jarvis", "chat"],
  },
  {
    id: "jarvis.sales.help.answer", title: "How Enginious OS works (published guidance from the Map)", kind: "knowledge",
    who: SALES, scope: "The published staff guidance only. No records are read",
    display: ["published guidance: title, summary, steps, links to screens"], outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis", "help"],
  },
  {
    id: "jarvis.sales.followups.overdue", title: "Show my overdue Sales follow-ups", kind: "lookup",
    who: SALES, scope: "The selected company only; open follow-ups assigned to the signed-in person, read through their own session",
    display: ["follow-up title", "follow-up type", "due date and days overdue", "enquiry reference and title", "link to the enquiry", "company name", "cutoff time", "count"],
    outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis", "lookups"],
  },
  {
    id: "jarvis.sales.enquiry.create_from_brief", title: "Create an enquiry from a brief", kind: "write",
    who: `${SALES} (the existing rules of creating an enquiry)`, scope: "One new enquiry in the selected company; organisations the person can see",
    display: ["the enquiry form's fields as proposed", "matching organisations (name, place)", "possible duplicates (reference, title, stage)", "the saved reference and link"],
    outbound: { provider: true, sources: ["user_text"], note: "The brief's non-sensitive narrative, prepared locally: pricing, budgets, costs, contacts, personal data, credentials and contract or restricted material are withheld or replaced before the call; labelled client and agency names go as placeholders." },
    confirmation: "review_card_and_acknowledgement", pausedBy: ["jarvis", "writes"],
  },
  {
    id: "jarvis.sales.draft_reply", title: "Draft a reply to a client about an enquiry", kind: "draft",
    who: SALES, scope: "One enquiry of the selected company that the person can see",
    display: ["the draft subject and body", "what to confirm before sending", "the enquiry reference and title"],
    outbound: { provider: true, sources: ["user_text", "enquiry_reply_facts"], note: "The pasted conversation and the enquiry's reply-relevant facts. Never the enquiry's value, budget note, owner, ids, estimates, proposals or any other record." },
    confirmation: "none", pausedBy: ["jarvis"],
  },
  {
    id: "jarvis.sales.organisation.register", title: "Register a client or agency", kind: "write",
    who: `${SALES} (the existing rules of Clients & Agencies)`, scope: "One new organisation; existing organisations the person can see are searched for duplicates",
    display: ["matching organisations (name, type, place, country, website)", "the proposed details", "the saved name and link"],
    outbound: NO_PROVIDER, confirmation: "review_card_and_acknowledgement", pausedBy: ["jarvis", "writes"],
  },
  {
    id: "jarvis.sales.enquiry.update", title: "Update an enquiry (ten fields)", kind: "write",
    who: "The enquiry's owner or a Sales founder of its company", scope: "One enquiry of the selected company; title, brief, event dates, installation date, location, technologies, scope, waiting on, budget note",
    display: ["each changed field, before and after", "the enquiry reference and title"],
    outbound: { provider: true, sources: ["user_text", "enquiry_update_fields"], note: "The request and the current values of the updatable fields of that one enquiry, except the budget note." },
    confirmation: "review_card", pausedBy: ["jarvis", "writes"],
  },
  {
    id: "jarvis.sales.enquiry.change_stage", title: "Change an enquiry's status (one step)", kind: "write",
    who: "The enquiry's owner or a Sales founder of its company", scope: "One enquiry of the selected company; one step between the six working stages",
    display: ["current and proposed stage", "whether the stage's evidence is recorded", "what the move does"],
    outbound: NO_PROVIDER, confirmation: "review_card", pausedBy: ["jarvis", "writes"],
  },
  {
    id: "jarvis.sales.meeting.record", title: "Turn meeting notes into an activity and a follow-up", kind: "write",
    who: SALES, scope: "One enquiry of the selected company; one activity and one follow-up for the signed-in person",
    display: ["the proposed activity and follow-up", "the enquiry reference and title"],
    outbound: { provider: true, sources: ["user_text"], note: "The pasted notes only." },
    confirmation: "review_card", pausedBy: ["jarvis", "writes"],
  },
  {
    id: "jarvis.memory.preferences", title: "What JARVIS remembers (personal preferences)", kind: "memory",
    who: "Anyone who may open JARVIS; only their own preferences", scope: "The signed-in person's own rows. Never business records, credentials, sensitive facts or chat text",
    display: ["the person's own saved preferences"],
    outbound: { provider: false, sources: [], note: "Saving, listing and deleting call no provider. A saved preference reaches the provider only as a fixed sentence inside a general chat request." },
    confirmation: "none", pausedBy: ["jarvis", "memory"],
  },
  {
    id: "jarvis.knowledge.suggest_correction", title: "Suggest a correction to the guidance", kind: "knowledge",
    who: "Anyone who may open JARVIS", scope: "One suggestion row of their own; it changes no guidance until it is reviewed and published through the Map",
    display: ["a confirmation that the suggestion was sent for review"], outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis", "help"],
  },
  {
    id: "jarvis.protected.guide", title: "Requests about protected information", kind: "guide",
    who: "Anyone who may open JARVIS", scope: "Reads only the person's own access (roles and grants), never the protected records",
    display: ["that JARVIS cannot show it", "the screen to use, when the person has access", "that the person has no access, without saying whether a record exists", "that access could not be checked"],
    outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis"],
  },
  {
    id: "jarvis.unsupported.live", title: "Live requests JARVIS does not support yet", kind: "guide",
    who: "Anyone who may open JARVIS", scope: "No records are read",
    display: ["what is not supported", "the screen to use instead"], outbound: NO_PROVIDER, confirmation: "none", pausedBy: ["jarvis"],
  },
];

const BY_ID = new Map(JARVIS_RULES.map((r) => [r.id, r]));
export const ruleFor = (id: string | null | undefined): JarvisRule | null => (id ? BY_ID.get(id) ?? null : null);

/** The information that never appears in a JARVIS response and never goes to the provider, in the rulebook's words. */
export const PROTECTED_SUMMARY =
  "salaries, payroll, reimbursements, medical and insurance details, personal IDs, private leave details, quote and estimate amounts, unit rates, discounts, margins and project financials";
