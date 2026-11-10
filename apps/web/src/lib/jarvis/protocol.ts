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
  | "paused"             // this kind of request (help, lookups, chat or memory) is paused by the operator
  | "protected_content"  // the text contains protected details: nothing was sent to the provider
  | "lookup_failed"      // a lookup could not be read: NOT the same as "no matching records" or "no access"
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
  /** What was kept inside Enginious OS instead of being sent to the AI model, and anything else the person should know about how the card was filled. */
  notice?: string | null;
}

export interface ConfirmationView { id: string; token: string; expiresAt: string }

export type SendResult =
  | { ok: true; kind: "help"; help: HelpView }
  | { ok: true; kind: "not_available"; title: string; reason: string }
  | { ok: true; kind: "info"; text: string }
  /** A plain answer written by the app itself (a greeting, a limit, where to find something): no model, no record. */
  | { ok: true; kind: "reply"; text: string; links: ReplyLink[] }
  /** ONE short question when the intent is unclear. Each option sends the same text again with that choice ("chat" = just answer it as a general message). */
  | { ok: true; kind: "clarify"; text: string; options: { label: string; intent: string }[] }
  /** A brief that mixes protected details with the rest and could not be separated safely: the person reviews and edits the text that WOULD be sent (nothing has been sent), or uses the form. */
  | { ok: true; kind: "brief_review"; text: string; outbound: string; formHref: string }
  /** What JARVIS remembers for this person (their own preferences only). */
  | { ok: true; kind: "memory"; text: string; preferences: import("./preferences").PreferenceView[] }
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
  /** "choose": two or more guides fit about equally, so the person is asked ONE short question (`choices`). */
  mode: "guidance" | "no_guidance" | "choose";
  /** The screen the answer is for, when the person asked about the screen they are on (the navigation's own name for it; never its contents). */
  screen?: { label: string } | null;
  /** For "choose": the guides to pick from. For "no guidance": screens whose NAME the question used, from the navigation. */
  choices?: { id: string; title: string }[];
  places?: { label: string; href: string }[];
  /** The question as asked, so a choice can be sent back with it. */
  question?: string;
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

/** `jarvis.sales.enquiry.change_stage`: ONE step between the six working stages, with the database's evidence gates shown and kept. */
export interface StageTransitionView { to: string; toLabel: string; direction: "forward" | "back"; enabled: boolean; reason: string | null }
export interface StageEvidenceView { label: string; met: boolean | null; text: string }
export interface StageValues { companyId: string; enquiryId: string; from: string; to: string }
export interface EnquiryStageCard {
  kind: "enquiry.stage";
  enquiry: EnquiryRef & { version: number };
  from: string; fromLabel: string;
  /** The proposed stage, or null while the person has not chosen one. */
  to: string | null; toLabel: string | null;
  transitions: StageTransitionView[];
  /** What the chosen move needs and whether it is recorded. */
  evidence: StageEvidenceView[];
  /** What the existing move does (and does not do), in words. */
  effects: string[];
  values: StageValues | null;
  problems: CardProblem[];
  valid: boolean;
}

/** `jarvis.sales.meeting.record`: meeting notes become ONE proposed activity and (optionally) ONE follow-up for you, saved together or not at all. */
export type ActivityKind = "call" | "email" | "meeting" | "note" | "client_response";
export type FollowUpKind = "call" | "email" | "meeting" | "proposal" | "other";
export interface MeetingValues {
  companyId: string; enquiryId: string;
  kind: ActivityKind; body: string; occurredOn: string | null; internal: boolean;
  planFollowUp: boolean; followUpTitle: string; followUpDate: string; followUpTime: string; followUpKind: FollowUpKind;
}
export interface MeetingCard {
  kind: "meeting.record";
  enquiry: EnquiryRef;
  values: MeetingValues;
  /** The follow-up date was not stated in the notes: JARVIS asks instead of guessing. */
  questions: CardQuestion[];
  problems: CardProblem[];
  valid: boolean;
}

export interface ReplyLink { label: string; href: string }

/** `jarvis.sales.chat.reply`: a general answer or a draft for the person to copy. Nothing is sent or saved; no record is read. */
export interface ChatReplyCard {
  kind: "chat.reply";
  text: string;
  /** True for something to copy and use (an email, a message); false for an answer. */
  draft: boolean;
  /** The saved preferences that were applied, in words (empty = none). */
  applied: string[];
}

/** The bounded context the panel sends with a message: the last few turns of the general conversation, and whether a lookup was just shown. Never stored; never treated as permission. */
export interface ChatTurn { role: "user" | "jarvis"; text: string }
export interface SendContext { turns?: ChatTurn[]; lastLookup?: { period: LookupPeriod } | null }

/** `jarvis.sales.followups.overdue`: computed and shown inside Enginious OS; nothing goes to the provider. An empty `items` means NO MATCHING RECORDS (a failed read and no access are refusals, never an empty list). */
export type LookupPeriod = "all" | "last_month" | "this_month" | "last_7_days" | "last_30_days";
export interface FollowUpsLookupCard {
  kind: "lookup.followups";
  company: { id: string; name: string };
  period: LookupPeriod;
  /** e.g. "that fell due in October 2026". */
  periodLabel: string;
  /** The moment the list was computed (ISO) and the same in words, Dubai time. */
  cutoff: string;
  cutoffLabel: string;
  total: number;
  /** More than the shown number exist: the Follow-ups page has them all. */
  truncated: boolean;
  items: { id: string; title: string; hidden: boolean; kindLabel: string; dueDate: string; daysOverdue: number; enquiry: { reference: string; title: string; href: string } | null }[];
  followUpsHref: string;
}

export type ActionCard = ReplyDraftCard | HelpAnswerCard | OrgRegisterCard | EnquiryUpdateCard | EnquiryStageCard | MeetingCard | ChatReplyCard | FollowUpsLookupCard;
