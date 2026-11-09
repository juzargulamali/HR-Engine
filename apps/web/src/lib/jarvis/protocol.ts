/**
 * What the JARVIS panel (browser) and the JARVIS server actions exchange. Plain JSON only: no secrets, no functions. The browser holds all of this in memory;
 * nothing here is stored on the server (the only server-side records are the action ledger and the daily usage counter, see supabase/migrations/20261223000100).
 */

export type JarvisRefusalCode =
  | "unavailable"        // hard-off (JARVIS_DISABLED), no provider key, or the confirmation secret is missing in production
  | "signed_out"
  | "not_available"      // the global switch is off or the person is not on the pilot allowlist
  | "writes_off"         // the write kill switch is off: read-only help keeps working
  | "company_not_allowed"
  | "no_module_access"   // no grant for the module (e.g. Sales) in THIS company
  | "unknown_action"
  | "action_disabled"
  | "invalid_input"
  | "excluded_request"   // refused before any provider call (payroll, leave, other modules, SQL, credentials, deployment, permissions, deletion)
  | "limit_reached"
  | "provider_error"
  | "token_invalid"
  | "token_expired"
  | "values_changed"     // the reviewed values differ from what the confirmation was issued for
  | "company_changed"
  | "needs_review"       // something changed since the review (a duplicate, a record, a permission): review again
  | "not_permitted"      // the existing rule of the action refused it
  | "save_failed"
  | "ambiguous";         // the answer to the save was lost: check the original result, never create again

export interface JarvisRefusal { ok: false; code: JarvisRefusalCode; message: string }

export interface HelpView {
  enabled: { id: string; title: string; description: string }[];
  disabled: { id: string; title: string; reason: string }[];
}

export type OrgField = "agency" | "client";
export interface OrgOption { id: string; name: string; place: string | null }
export interface OrgChoice {
  field: OrgField;
  /** What the brief said (or the person typed to search). */
  typedName: string | null;
  status: "none" | "matched" | "suggested" | "ambiguous" | "not_found" | "wrong_role";
  selectedId: string | null;
  selectedName: string | null;
  options: OrgOption[];
  /** Plain words for the person, e.g. "register this organisation first". */
  guidance: string | null;
}

export interface EnquiryValues {
  companyId: string;
  title: string;
  source: string;
  agencyOrgId: string | null;
  clientOrgId: string | null;
  currency: string | null;
  value: number | null;
  budgetNote: string | null;
  brief: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  installStart: string | null;
  location: string | null;
  technologies: { name: string; qty: number }[];
  scope: string | null;
  waitingOn: "client" | "internal" | null;
  nextTitle: string;
  nextDate: string;
  nextTime: string;
  nextKind: "call" | "email" | "meeting" | "proposal" | "other";
}

export interface CardProblem { field: string; message: string }
export interface CardQuestion { field: string; text: string; options?: { value: string; label: string }[] }
export interface DuplicateView { id: string; reference: string; title: string; stage: string; level: "likely" | "possible"; reasons: string[] }

export interface EnquiryCard {
  kind: "enquiry.create";
  company: { id: string; name: string };
  values: EnquiryValues;
  agency: OrgChoice;
  client: OrgChoice;
  problems: CardProblem[];
  questions: CardQuestion[];
  duplicates: DuplicateView[];
  /** True when the reviewed values are complete and valid: only then is a confirmation issued. */
  valid: boolean;
  /** Everything the model returned that was kept, by field: lets the card show "from your brief" and leave the rest blank. */
  fromBrief: string[];
}

export interface ConfirmationView { id: string; token: string; expiresAt: string }

export type SendResult =
  | { ok: true; kind: "help"; help: HelpView }
  | { ok: true; kind: "not_available"; title: string; reason: string }
  | { ok: true; kind: "info"; text: string }
  | { ok: true; kind: "card"; card: EnquiryCard; confirmation: ConfirmationView | null }
  /** Any other registered action (draft a reply, help, register an organisation, update, change stage, meeting notes): the card is that action's own. */
  | { ok: true; kind: "action"; actionId: string; card: ActionCard; confirmation: ConfirmationView | null }
  | JarvisRefusal;

/** What a generic action's confirmed save returns: the real record reference (only after the app read it back) and where to open it. */
export interface ActionDone { ok: true; status: "done"; confirmationId: string; actionId: string; reference: string; href: string | null; summary: string; replayed: boolean }
export type ActionConfirmResult = ActionDone | (JarvisRefusal & { confirmationId?: string });

export interface ConfirmDone { ok: true; status: "done"; confirmationId: string; reference: string; opportunityId: string; href: string; replayed: boolean }
export type ConfirmResult = ConfirmDone | (JarvisRefusal & { confirmationId?: string });

export type StatusResult =
  | { ok: true; state: "done"; reference: string; opportunityId: string; href: string | null; summary?: string; actionId?: string }
  | { ok: true; state: "failed"; message: string }
  | { ok: true; state: "not_recorded" }
  | JarvisRefusal;

export interface LauncherState {
  available: boolean; writes: boolean; companies: { id: string; name: string }[]; maxInputChars: number;
  /** Ids of the actions that are enabled (the panel offers a mode for each; the server checks every call again). */
  enabledActionIds: string[];
}

export interface ContextView {
  company: { id: string; name: string } | null;
  enquiry: { id: string; reference: string; title: string; companyId: string } | null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Cards of the other Sales actions (part 2). Each card is plain JSON built by the server from records the person can see; the browser only draws it.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface EnquiryRef { id: string; reference: string; title: string; stage: string; stageLabel: string; companyId: string }

/** `jarvis.sales.draft_reply`: a DRAFT only. Nothing is sent, nothing is written. */
export interface ReplyDraftCard {
  kind: "reply.draft";
  enquiry: EnquiryRef;
  subject: string;
  body: string;
  /** UNCONFIRMED prices, dates and availability (and promises) found in the draft: shown ABOVE it; confirm each one before anything is sent. */
  toConfirm: { kind: "price" | "date" | "availability" | "promise" | "other"; text: string; origin: "model" | "check" }[];
  /** Values the draft uses that really are in the enquiry or in the person's own text, and which of the two. */
  used: { value: string; source: "enquiry" | "your text" }[];
}

/** `jarvis.sales.help.answer`: an answer from reviewed guidance (with the screens it links to) or, for a general question, a plain model answer that says so. Reads nothing. */
export interface HelpAnswerCard {
  kind: "help.answer";
  mode: "guidance" | "no_guidance" | "general";
  /** Only for a general (non-app) question: the model's short answer. */
  answer: string | null;
  entries: { id: string; title: string; summary: string; steps: string[]; links: { label: string; href: string }[] }[];
  /** For "no reviewed guidance": the topics there is guidance for. */
  topics: { id: string; title: string }[];
  note: string;
}

/** `jarvis.sales.organisation.register`. Two steps: "search" (what already exists; the person chooses to use it or to register a NEW one) then "details" (the exact type and fields, with their OWN confirmation). */
export type OrgRole = "agency" | "direct" | "client" | "technology";
export interface OrgValues { companyId: string; name: string; roles: OrgRole[]; country: string | null; website: string | null; place: string | null; note: string | null }
export interface OrgMatchView { id: string; name: string; roles: string[]; place: string | null; country: string | null; website: string | null; reasons: ("same name" | "same website" | "similar name")[]; binding: boolean }
export interface OrgRegisterCard {
  kind: "org.register";
  stage: "search" | "details";
  company: { id: string; name: string };
  /** What the person typed to search. */
  query: string;
  matches: OrgMatchView[];
  values: OrgValues;
  problems: CardProblem[];
  valid: boolean;
  roleOptions: { id: OrgRole; label: string }[];
}

/**
 * `jarvis.sales.enquiry.update`: ONLY these fields can be changed through JARVIS (the allowlist, also enforced in the database wrapper). Not here, on purpose: owner, stage, agency,
 * end client, value, currency, payment terms, exclusions, risks, evidence, files, proposals, Zoho, handover, closure.
 */
export const UPDATE_FIELDS = ["title", "brief", "eventStart", "eventEnd", "installStart", "location", "technologies", "scope", "waitingOn", "budgetNote"] as const;
export type UpdateFieldKey = (typeof UPDATE_FIELDS)[number];
export interface UpdateForm {
  title: string; brief: string | null; eventStart: string | null; eventEnd: string | null; installStart: string | null; location: string | null;
  technologies: { name: string; qty: number }[]; scope: string | null; waitingOn: "client" | "internal" | null; budgetNote: string | null;
}
/** What is bound to the confirmation: the enquiry, its company and ONLY the fields that change (new values). The record version is bound by the token. */
export interface UpdateValues { companyId: string; enquiryId: string; patch: Partial<UpdateForm> }
export interface UpdateChange { field: UpdateFieldKey; label: string; before: string; after: string }
export interface EnquiryUpdateCard {
  kind: "enquiry.update";
  enquiry: EnquiryRef & { version: number };
  /** Each changed field, before -> after, in words. */
  changes: UpdateChange[];
  /** The enquiry's current values of the allowlisted fields, and the proposed ones (the form edits `proposed`). */
  current: UpdateForm;
  proposed: UpdateForm;
  fields: { key: UpdateFieldKey; label: string }[];
  values: UpdateValues;
  problems: CardProblem[];
  valid: boolean;
}

export type ActionCard = ReplyDraftCard | HelpAnswerCard | OrgRegisterCard | EnquiryUpdateCard;
