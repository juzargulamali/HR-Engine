import { CRM_SOURCES } from "@enginious-hr/domain";
import type { ActiveCompanySource } from "@/lib/crm/active-company";
import { hasRoleFor } from "@/lib/crm/organisation-roles";

/**
 * What Quick Add and the full Add enquiry form share: labels, help text, defaults, the company and currency rules, the checks made before saving, and the
 * address that carries a half-filled Quick Add into the full form. Pure (no React, no server-only imports), so both forms, the server page and the tests use
 * the same rules. Nothing here grants anything: the database decides who may record an enquiry for which company.
 */

// ---------------------------------------------------------------------------------------------------------------
// Labels, help and defaults
// ---------------------------------------------------------------------------------------------------------------

export const NEXT_KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;
export type NextKind = (typeof NEXT_KINDS)[number][0];
export const CURRENCY_SUGGESTIONS = ["AED", "SAR", "EUR", "USD", "GBP"];
export const DEFAULT_NEXT_TIME = "10:00";
export const DEFAULT_NEXT_KIND: NextKind = "call";
/** Every Sales due time is a Dubai wall-clock time (the server converts it), whichever company the enquiry is for. */
export const DUE_TIME_LABEL = "Time (Dubai)";

export const ENQUIRY_LABELS = {
  company: "Company",
  title: "What is the enquiry?",
  source: "Where did it come from?",
  agency: "Agency",
  client: "End client",
  next: "Next action",
  due: "Due date",
  owner: "Owner",
  currency: "Currency",
  value: "Budget or value",
} as const;

/** Explanations that sit behind the ⓘ beside a label. What a person must read to save (required marks, errors, what saving does) stays on the page. */
export const ENQUIRY_HELP = {
  company: "The Enginious company this enquiry belongs to. It decides the reference, the default currency and who can see it. Only companies you have Sales access to are listed.",
  title: "A title or one-line brief, for example “LED tunnel for a mall activation”.",
  agency: "The agency that sent the brief, if there is one. It is not the end client: record the brand the work is for under End client.",
  client: "The brand or company the work is for. If an agency sent the brief, the agency goes under Agency and the brand goes here.",
  event: "Link the enquiry to the specific show it is for. Leave empty if it is not for an event.",
  next: "For example “Call to qualify the brief”. It appears in the owner's follow-ups on the date and time you set.",
  owner: "You can give the enquiry to a colleague with Sales access to this company. They are then responsible for it.",
  location: "Venue or city.",
  waitingOn: "Who the next move depends on. Leave it as Nobody if it depends on nobody.",
  brief: "What the client asked for, in their words if you can.",
  scope: "What we would supply and do.",
  budgetNote: "For example “about 150k, flexible” or “client has not shared a budget”.",
  value: "A value you have been given or an estimate. Values are never added across currencies.",
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Company and currency
// ---------------------------------------------------------------------------------------------------------------

/**
 * The company a form starts in: the active Sales company (lib/crm/active-company.ts), when it is one of the companies offered. Otherwise none, and the form
 * asks the person to choose. It never falls back to the first company in the list.
 */
export function startingCompanyId(companies: readonly { id: string }[], active: { id: string | null; from: ActiveCompanySource }): string {
  if (active.from === "choose" || active.from === "none" || !active.id) return "";
  return companies.some((c) => c.id === active.id) ? active.id : "";
}

export interface CurrencyState {
  /** What is saved: the person's own code when they typed one, otherwise the company's default ("" when there is neither). */
  value: string;
  /** "chosen" = typed or picked by the person; "default" = the company's default; "none" = nothing to use yet. */
  source: "chosen" | "default" | "none";
}

/**
 * The currency of a new enquiry. `chosen` is what the person typed (null = never touched). A choice is kept when the company changes; an untouched or
 * emptied field follows the chosen company's default quote currency.
 */
export function resolveCurrency(chosen: string | null, companyDefault: string | null | undefined): CurrencyState {
  const own = (chosen ?? "").trim().toUpperCase();
  if (own) return { value: own, source: "chosen" };
  return companyDefault ? { value: companyDefault, source: "default" } : { value: "", source: "none" };
}

/** The sentence under the Currency field: which currency it is and whether it follows the company. */
export function currencyNote(state: CurrencyState, companyName: string | null): string {
  if (state.source === "chosen") return `You chose ${state.value}. It stays ${state.value} if you change the company.`;
  if (state.source === "default") return `${state.value} is ${companyName ?? "the company"}'s default currency. It follows the company until you choose another.`;
  return "Any 3-letter code, for example AED.";
}

/** Company and currency together, in words, shown right before the save button. Null while no company is chosen. */
export function savingTo(company: { name: string } | null, currency: CurrencyState): string | null {
  if (!company) return null;
  return currency.value ? `Saving to ${company.name} in ${currency.value}` : `Saving to ${company.name}`;
}

/** The checks both forms make before sending (the server and the database make them again). Null when the enquiry can be sent. */
export function enquiryBlockedReason(i: { company: { name: string; hasSettings: boolean } | null; agencyId: string; clientId: string; techError?: string | null }): string | null {
  if (!i.company) return "Choose the company this enquiry is for.";
  if (!i.company.hasSettings) return `${i.company.name} has no Sales settings yet, so an enquiry cannot be recorded for it.`;
  if (!i.agencyId && !i.clientId) return "Choose an agency, an end client, or both. An enquiry needs at least one of them. Contacts are optional.";
  return i.techError ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Where a save or Cancel returns to
// ---------------------------------------------------------------------------------------------------------------

const hasControlChars = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 32);

/** An address inside Sales (path and query only). Anything else, including another site or a path that only looks local, is refused. */
export function safeSalesPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 600) return null;
  if (!/^\/sales(\/|\?|$)/.test(raw) || raw.includes("//") || raw.includes("\\") || hasControlChars(raw)) return null;
  return raw;
}

/** The lists that can show an enquiry in the side panel with `?open=<id>`. */
const PANEL_LISTS = ["/sales/follow-ups", "/sales/opportunities"];

/**
 * Where Quick Add lands after a save: the list the person added it from, with the new enquiry open beside it and their filters kept. Only the Follow-ups and
 * Enquiries lists are accepted (they are the ones that can show the panel); anything else lands on Enquiries.
 */
export function panelReturnHref(raw: string | null | undefined, id: string): string {
  const safe = safeSalesPath(raw);
  const [path = "", query = ""] = (safe ?? "").split("?");
  const base = PANEL_LISTS.includes(path) ? path : "/sales/opportunities";
  const p = new URLSearchParams(base === path ? query : "");
  p.delete("add"); p.delete("open"); p.delete("page");
  p.set("open", id);
  return `${base}?${p.toString()}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Prefill of the full form from the address
// ---------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Free text longer than this is never put in an address: Quick Add hands it over in this browser tab instead (see `CARRY_KEY`). */
export const ADDRESS_TEXT_MAX = 300;
const BRIEF_MAX = 4000;

export interface EnquiryPrefill {
  companyId: string;
  title: string;
  agencyId: string;
  clientId: string;
  editionId: string;
  source: string;
  nextTitle: string;
  nextDate: string;
  nextTime: string;
  nextKind: string;
  brief: string;
  value: string;
  /** A currency named in the address counts as the person's own choice: it does not follow the company. */
  currency: string;
  ownerId: string;
  location: string;
  contactIds: string[];
  eventStart: string;
  eventEnd: string;
  installStart: string;
  budgetNote: string;
  /** The outreach the enquiry is raised from: linked once the enquiry is saved. */
  outreachId: string;
  /** Where Cancel goes (an address inside Sales), or "". */
  returnTo: string;
  /** A hand-over token: the longer text typed in Quick Add waits in this browser tab under it. */
  carry: string;
}

export const EMPTY_PREFILL: EnquiryPrefill = {
  companyId: "", title: "", agencyId: "", clientId: "", editionId: "", source: "", nextTitle: "", nextDate: "", nextTime: "", nextKind: "", brief: "", value: "", currency: "",
  ownerId: "", location: "", contactIds: [], eventStart: "", eventEnd: "", installStart: "", budgetNote: "", outreachId: "", returnTo: "", carry: "",
};

export interface PrefillKnown {
  companies: readonly { id: string; canAssignOwner: boolean; people: readonly { id: string }[] }[];
  organisations: readonly { id: string; kind: string; roles?: readonly string[] | null }[];
  editions: readonly { id: string }[];
  contacts: readonly { id: string; organisationId: string | null }[];
  currentUserId: string;
  /** Today in Dubai (YYYY-MM-DD): a due date in the past is not carried. */
  today: string;
}

type Address = Record<string, string | string[] | undefined> | URLSearchParams;
const all = (sp: Address, key: string): string[] => {
  if (sp instanceof URLSearchParams) return sp.getAll(key);
  const v = sp[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
const one = (sp: Address, key: string): string => (all(sp, key)[0] ?? "").trim();

/**
 * Reads the full form's starting values from its address. The parameters are:
 * `company, title, agency, client, edition, source, next, due, dueTime, nextKind, brief, value, currency, owner, location, contact, org, outreach`
 * plus `es, ee, install, note` (event start, event end, installation date, budget note), `returnTo` and `carry`, which Quick Add adds.
 *
 * Nothing in an address is trusted. An id is used only when it is one the person was given (their companies, the organisations, editions and contacts the page
 * loaded, the people of the chosen company); a value that is not is dropped and named in `ignored`, so the form can say that something in the link was not
 * used. `org` is an account without a side: it goes in the picker its role fits (end client first), unless `agency` or `client` already fills that side.
 */
export function parseEnquiryPrefill(sp: Address, known: PrefillKnown): { values: EnquiryPrefill; ignored: string[] } {
  const v: EnquiryPrefill = { ...EMPTY_PREFILL, contactIds: [] };
  const ignored: string[] = [];
  const drop = (name: string) => { if (!ignored.includes(name)) ignored.push(name); };
  const id = (key: string, ok: (id: string) => boolean): string => {
    const raw = one(sp, key);
    if (!raw) return "";
    if (UUID.test(raw) && ok(raw)) return raw;
    drop(key);
    return "";
  };
  const text = (key: string, max: number): string => one(sp, key).slice(0, max);

  v.companyId = id("company", (x) => known.companies.some((c) => c.id === x));
  const org = (x: string) => known.organisations.find((o) => o.id === x);
  v.agencyId = id("agency", (x) => { const o = org(x); return !!o && hasRoleFor(o, "agency"); });
  v.clientId = id("client", (x) => { const o = org(x); return !!o && hasRoleFor(o, "client"); });
  const account = id("org", (x) => !!org(x));
  if (account) {
    const o = org(account)!;
    const side = hasRoleFor(o, "client") || !hasRoleFor(o, "agency") ? "client" : "agency";
    if (side === "client" && !v.clientId) v.clientId = account;
    else if (side === "agency" && !v.agencyId) v.agencyId = account;
  }
  // The outreach is linked to the enquiry after the save, so it is only carried together with the account it belongs to.
  const outreach = one(sp, "outreach");
  if (outreach) { if (UUID.test(outreach) && account) v.outreachId = outreach; else drop("outreach"); }

  v.editionId = id("edition", (x) => known.editions.some((e) => e.id === x));
  const source = one(sp, "source");
  if (source) { if (CRM_SOURCES.some((s) => s.id === source)) v.source = source; else drop("source"); }
  v.title = text("title", 200);
  v.nextTitle = text("next", 200);
  const due = one(sp, "due");
  if (due) { if (DATE.test(due) && due >= known.today) v.nextDate = due; else drop("due"); }
  const dueTime = one(sp, "dueTime");
  if (dueTime) { if (TIME.test(dueTime)) v.nextTime = dueTime; else drop("dueTime"); }
  const kind = one(sp, "nextKind");
  if (kind) { if (NEXT_KINDS.some(([k]) => k === kind)) v.nextKind = kind; else drop("nextKind"); }
  v.brief = text("brief", BRIEF_MAX);
  const value = one(sp, "value");
  if (value) { const n = Number(value); if (Number.isFinite(n) && n >= 0) v.value = value; else drop("value"); }
  const currency = one(sp, "currency");
  if (currency) { if (/^[A-Za-z]{3}$/.test(currency)) v.currency = currency.toUpperCase(); else drop("currency"); }
  v.location = text("location", 200);
  v.budgetNote = text("note", ADDRESS_TEXT_MAX);
  for (const [key, field] of [["es", "eventStart"], ["ee", "eventEnd"], ["install", "installStart"]] as const) {
    const d = one(sp, key);
    if (d) { if (DATE.test(d)) v[field] = d; else drop(key); }
  }

  // Giving an enquiry to a colleague needs the right to assign owners in that company, and the colleague must have Sales access to it.
  const owner = one(sp, "owner");
  if (owner) {
    const company = known.companies.find((c) => c.id === v.companyId);
    if (UUID.test(owner) && (owner === known.currentUserId || (!!company && company.canAssignOwner && company.people.some((p) => p.id === owner)))) v.ownerId = owner;
    else drop("owner");
  }
  // Contacts belong to one of the chosen organisations; `contact` may be repeated or a comma list.
  const chosenOrgs = new Set([v.agencyId, v.clientId].filter(Boolean));
  for (const c of all(sp, "contact").flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean)) {
    const found = UUID.test(c) ? known.contacts.find((k) => k.id === c) : undefined;
    if (found && found.organisationId && chosenOrgs.has(found.organisationId)) { if (!v.contactIds.includes(c)) v.contactIds.push(c); }
    else drop("contact");
  }
  v.returnTo = safeSalesPath(one(sp, "returnTo")) ?? "";
  const carry = one(sp, "carry");
  v.carry = /^[a-z0-9]{6,24}$/i.test(carry) ? carry : "";
  return { values: v, ignored };
}

/** True when the address brought anything for the form (not only where to return to). */
export const hasPrefill = (v: EnquiryPrefill): boolean =>
  !!(v.companyId || v.title || v.agencyId || v.clientId || v.editionId || v.source || v.nextTitle || v.nextDate || v.nextTime || v.nextKind || v.brief || v.value || v.currency
    || v.ownerId || v.location || v.contactIds.length || v.eventStart || v.eventEnd || v.installStart || v.budgetNote || v.outreachId || v.carry);

// ---------------------------------------------------------------------------------------------------------------
// Quick Add: "Open the full form" keeps what was typed
// ---------------------------------------------------------------------------------------------------------------

/** What Quick Add holds when the person asks for the full form (its own field names, as posted). */
export interface QuickAddDraft {
  companyId?: string; title?: string; agencyOrgId?: string; clientOrgId?: string; eventEditionId?: string; source?: string; nextTitle?: string; nextDate?: string; nextTime?: string;
  nextKind?: string; brief?: string; value?: string; /** Only when the person chose it themselves: a default follows the company. */ currency?: string; ownerId?: string; location?: string;
  eventStart?: string; eventEnd?: string; installStart?: string; budgetNote?: string; /** The technologies rows as the form posts them (JSON). */ technologies?: string;
}

/** What is too long, or the wrong shape, for an address. It waits in sessionStorage (this browser tab only) under `CARRY_KEY` until the full form reads it once. */
export interface CarriedDraft { token: string; brief?: string; technologies?: { name: string; qty: number }[] }
export const CARRY_KEY = "sales:new-enquiry:carry";

/**
 * The full form's address for a Quick Add draft, and what has to be handed over outside the address (a long brief, the technologies). The address never holds
 * more than `ADDRESS_TEXT_MAX` characters of free text per field.
 */
export function fullFormHandOff(draft: QuickAddDraft, opts: { returnTo?: string | null; currentUserId?: string; token: string }): { href: string; carried: CarriedDraft | null } {
  const p = new URLSearchParams();
  const put = (key: string, value: string | undefined, max = 200) => { const t = (value ?? "").trim(); if (t) p.set(key, t.slice(0, max)); };
  put("company", draft.companyId); put("title", draft.title); put("agency", draft.agencyOrgId); put("client", draft.clientOrgId); put("edition", draft.eventEditionId);
  put("source", draft.source); put("next", draft.nextTitle); put("due", draft.nextDate);
  if (draft.nextTime && draft.nextTime !== DEFAULT_NEXT_TIME) put("dueTime", draft.nextTime);
  if (draft.nextKind && draft.nextKind !== DEFAULT_NEXT_KIND) put("nextKind", draft.nextKind);
  put("value", draft.value); put("currency", draft.currency);
  if (draft.ownerId && draft.ownerId !== opts.currentUserId) put("owner", draft.ownerId);
  put("location", draft.location); put("es", draft.eventStart); put("ee", draft.eventEnd); put("install", draft.installStart); put("note", draft.budgetNote, ADDRESS_TEXT_MAX);

  const carried: CarriedDraft = { token: opts.token };
  const brief = (draft.brief ?? "").trim();
  if (brief.length > ADDRESS_TEXT_MAX) carried.brief = brief.slice(0, BRIEF_MAX);
  else if (brief) p.set("brief", brief);
  let tech: { name: string; qty: number }[] = [];
  try { const parsed: unknown = JSON.parse(draft.technologies || "[]"); if (Array.isArray(parsed)) tech = parsed.filter((t): t is { name: string; qty: number } => !!t && typeof t.name === "string" && t.name.trim() !== ""); } catch { /* not a list: nothing to carry */ }
  if (tech.length > 0) carried.technologies = tech.slice(0, 50).map((t) => ({ name: t.name.trim().slice(0, 200), qty: Number.isFinite(Number(t.qty)) && Number(t.qty) >= 1 ? Math.floor(Number(t.qty)) : 1 }));
  const hasCarried = carried.brief !== undefined || carried.technologies !== undefined;
  if (hasCarried) p.set("carry", opts.token);
  const back = safeSalesPath(opts.returnTo);
  if (back) p.set("returnTo", back);
  const qs = p.toString();
  return { href: qs ? `/sales/new?${qs}` : "/sales/new", carried: hasCarried ? carried : null };
}

/** Reads what Quick Add left for this token (a stale or foreign value is ignored). Pure: the caller passes the stored text. */
export function readCarried(stored: string | null, token: string): CarriedDraft | null {
  if (!stored || !token) return null;
  try {
    const d = JSON.parse(stored) as CarriedDraft;
    if (!d || d.token !== token) return null;
    return {
      token,
      ...(typeof d.brief === "string" ? { brief: d.brief.slice(0, BRIEF_MAX) } : {}),
      ...(Array.isArray(d.technologies) ? { technologies: d.technologies.filter((t) => t && typeof t.name === "string").slice(0, 50).map((t) => ({ name: String(t.name).slice(0, 200), qty: Number(t.qty) >= 1 ? Math.floor(Number(t.qty)) : 1 })) } : {}),
    };
  } catch { return null; }
}
