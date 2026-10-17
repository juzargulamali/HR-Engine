/**
 * ENGINIOUS OS design preview — FICTIONAL SAMPLE DATA ONLY.
 *
 * Nothing in this file is read from, or written to, any database. Names, companies, figures and
 * references are invented so the screens can be judged visually. "Today" is fixed so overdue / due-today
 * states are deterministic: Monday 19 October 2026, 09:30 GST (UTC+4).
 */

export const TODAY = "2026-10-19";
export const NOW = "2026-10-19T09:30";
export const SAMPLE_PERIOD = { from: "2026-07-01", to: TODAY };

export type StageId = "new" | "qualified" | "proposal_prep" | "proposal_sent" | "quote_sent" | "negotiation" | "won" | "lost" | "on_hold";
export type CompanyId = "uae" | "ksa" | "eu";
export type Currency = "AED" | "SAR" | "EUR";

export const STAGES: { id: StageId; label: string; open: boolean }[] = [
  { id: "new", label: "New enquiry", open: true },
  { id: "qualified", label: "Qualified", open: true },
  { id: "proposal_prep", label: "Proposal preparation", open: true },
  { id: "proposal_sent", label: "Proposal sent", open: true },
  { id: "quote_sent", label: "Quote sent", open: true },
  { id: "negotiation", label: "Negotiation", open: true },
  { id: "won", label: "Won", open: false },
  { id: "lost", label: "Lost", open: false },
  { id: "on_hold", label: "On hold", open: true },
];
export const PIPELINE_STAGES: StageId[] = ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"];
export const stageLabel = (id: StageId) => STAGES.find((s) => s.id === id)!.label;

/** Controlled moves (stable ids). Won/Lost are never plain moves: they go through the confirmation page. */
export function allowedMoves(from: StageId): StageId[] {
  const open: StageId[] = PIPELINE_STAGES;
  if (from === "won" || from === "lost") return [];
  if (from === "on_hold") return open.slice(0, 5);
  const i = open.indexOf(from);
  const forward = open.slice(i + 1);
  const back: StageId[] = i > 0 ? open.slice(i - 1, i) : [];
  return [...back, ...forward, "on_hold"];
}

export const COMPANIES: Record<CompanyId, { name: string; currency: Currency }> = {
  uae: { name: "Enginious UAE (sample entity)", currency: "AED" },
  ksa: { name: "Enginious KSA (sample entity)", currency: "SAR" },
  eu: { name: "Enginious Europe (sample entity)", currency: "EUR" },
};

export const PEOPLE = {
  juzar: { id: "juzar", name: "Juzar", title: "Founder" },
  rafi: { id: "rafi", name: "Rafi", title: "Founder" },
  amira: { id: "amira", name: "Amira Nasser", title: "Sales" },
  daniel: { id: "daniel", name: "Daniel Okafor", title: "Sales" },
  lena: { id: "lena", name: "Lena Hartmann", title: "Sales" },
  priya: { id: "priya", name: "Priya Raman", title: "Project Manager" },
  omar: { id: "omar", name: "Omar Haddad", title: "Head of Programming" },
  sofia: { id: "sofia", name: "Sofia Marin", title: "Head of Content" },
  karim: { id: "karim", name: "Karim Saleh", title: "Head of Engineering" },
  tariq: { id: "tariq", name: "Tariq Aziz", title: "Content Designer" },
} as const;
export type PersonId = keyof typeof PEOPLE;
export const personName = (id: string) => PEOPLE[id as PersonId]?.name ?? id;

export const SALES_USERS: PersonId[] = ["amira", "daniel", "lena"];
export const FOUNDERS: PersonId[] = ["juzar", "rafi"];

export const SOURCES = ["Agency call (outbound)", "LinkedIn", "Direct client", "WhatsApp", "Instagram", "Website enquiry", "Referral"] as const;
export const LOST_REASONS = ["Budget lower than scope", "Went with another supplier", "Event cancelled", "Timeline not feasible", "Technology not available", "No response from client"] as const;
export const HOLD_REASONS = ["Client postponed event", "Waiting for venue confirmation", "Waiting for client budget approval", "Internal capacity", "Other (note required)"] as const;

export type OrgType = "agency" | "client" | "direct";
export interface Org { id: string; name: string; type: OrgType; place: string; note: string }
export const ORGS: Org[] = [
  { id: "o-northwind", name: "Northwind Agency", type: "agency", place: "Dubai, UAE", note: "Repeat agency. Prefers PDF proposals plus one call." },
  { id: "o-brightpoint", name: "Brightpoint Events", type: "agency", place: "Abu Dhabi, UAE", note: "Mid-size agency; usually short lead times." },
  { id: "o-meridian", name: "Meridian Live", type: "agency", place: "London, UK", note: "Works across UAE and Europe." },
  { id: "o-aurora", name: "Aurora Motors", type: "client", place: "Dubai, UAE", note: "End client of Northwind Agency." },
  { id: "o-delta", name: "Delta Retail Group", type: "client", place: "Sharjah, UAE", note: "End client of Brightpoint Events." },
  { id: "o-solis", name: "Solis Hospitality", type: "client", place: "Abu Dhabi, UAE", note: "End client of Meridian Live." },
  { id: "o-helix", name: "Helix Pharma", type: "client", place: "Berlin, Germany", note: "End client of Northwind Agency." },
  { id: "o-orbit", name: "Orbit Tech", type: "client", place: "Dubai, UAE", note: "End client of Meridian Live." },
  { id: "o-atlas", name: "Atlas Motors", type: "client", place: "Dubai, UAE", note: "End client of Brightpoint Events." },
  { id: "o-crest", name: "Crest Auto", type: "client", place: "Dubai, UAE", note: "End client of Northwind Agency." },
  { id: "o-skyline", name: "Skyline Airport Lounges", type: "client", place: "Frankfurt, Germany", note: "End client of Meridian Live." },
  { id: "o-pinecrest", name: "Pinecrest Museum", type: "direct", place: "Riyadh, KSA", note: "Direct client." },
  { id: "o-lumen", name: "Lumen Bank", type: "direct", place: "Jeddah, KSA", note: "Direct client." },
  { id: "o-harbour", name: "Harbour Marina", type: "direct", place: "Valletta, Malta", note: "Direct client." },
  { id: "o-verde", name: "Verde Resort", type: "direct", place: "AlUla, KSA", note: "Direct client." },
  { id: "o-heritage", name: "Heritage Fort Trust", type: "direct", place: "Diriyah, KSA", note: "Direct client." },
  { id: "o-palm", name: "Palm Atrium Management", type: "direct", place: "Dubai, UAE", note: "Direct client." },
];
export const orgById = (id: string) => ORGS.find((o) => o.id === id)!;

export interface Contact { id: string; orgId: string; name: string; role: string; email: string; phone: string }
export const CONTACTS: Contact[] = [
  { id: "c1", orgId: "o-northwind", name: "Hana Verma", role: "Senior Producer", email: "hana.verma@example.test", phone: "+971 50 000 0101" },
  { id: "c2", orgId: "o-northwind", name: "Marcus Bell", role: "Accounts", email: "marcus.bell@example.test", phone: "+971 50 000 0102" },
  { id: "c3", orgId: "o-aurora", name: "Reem Al Falasi", role: "Marketing Director", email: "reem.alfalasi@example.test", phone: "+971 50 000 0103" },
  { id: "c4", orgId: "o-brightpoint", name: "Yusuf Karimi", role: "Creative Director", email: "yusuf.karimi@example.test", phone: "+971 50 000 0104" },
  { id: "c5", orgId: "o-delta", name: "Noor Haddad", role: "Brand Manager", email: "noor.haddad@example.test", phone: "+971 50 000 0105" },
  { id: "c6", orgId: "o-pinecrest", name: "Dr. Layla Mansour", role: "Head of Exhibitions", email: "layla.mansour@example.test", phone: "+966 50 000 0106" },
  { id: "c7", orgId: "o-meridian", name: "Oliver Grant", role: "Head of Production", email: "oliver.grant@example.test", phone: "+44 20 0000 0107" },
  { id: "c8", orgId: "o-solis", name: "Camille Dupont", role: "Events Lead", email: "camille.dupont@example.test", phone: "+971 50 000 0108" },
  { id: "c9", orgId: "o-helix", name: "Dr. Jonas Weber", role: "Congress Manager", email: "jonas.weber@example.test", phone: "+49 30 0000 0109" },
  { id: "c10", orgId: "o-lumen", name: "Faisal Rahman", role: "Branch Experience Lead", email: "faisal.rahman@example.test", phone: "+966 50 000 0110" },
  { id: "c11", orgId: "o-orbit", name: "Mei Lin", role: "Marketing Manager", email: "mei.lin@example.test", phone: "+971 50 000 0111" },
  { id: "c12", orgId: "o-harbour", name: "Joseph Camilleri", role: "Operations Manager", email: "joseph.camilleri@example.test", phone: "+356 0000 0112" },
];
export const contactById = (id: string) => CONTACTS.find((c) => c.id === id)!;

export type Availability =
  | { state: "unverified" }
  | { state: "awaiting"; requestedBy: string; requestedAt: string }
  | { state: "confirmed"; by: string; at: string; notes: string }
  | { state: "unavailable"; by: string; at: string; alternative: string };

export interface Evidence { type: "Purchase order" | "Authorised email"; reference: string; date: string }
export type Waiting = "client" | "internal" | null;

export interface Opportunity {
  id: string;
  ref: string;
  title: string;
  brief: string;
  agencyId: string | null;
  endClientId: string | null;
  contacts: { contactId: string; role: string }[];
  source: (typeof SOURCES)[number];
  owner: PersonId;
  createdBy: PersonId;
  company: CompanyId;
  currency: Currency;
  value: number | null;
  budgetNote: string | null;
  stage: StageId;
  createdAt: string;
  firstResponseAt: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  installStart: string | null;
  location: string | null;
  technologies: string[];
  scope: string;
  exclusions: string;
  availability: Availability;
  waiting: Waiting;
  holdReason?: string;
  holdReview?: string;
  lostReason?: string;
  closedAt?: string;
  evidence?: Evidence;
  handover?: "prepared" | null;
  paymentTerms: string | null;
  risks: string[];
}

const T = (s: string) => s.split("|");

export const OPPORTUNITIES: Opportunity[] = [
  {
    id: "41", ref: "OPP-2026-0041", title: "Interactive floor projection — showroom launch",
    brief: "Floor-projected interactive game for a three-day vehicle showroom launch. Agency wants a second proposal option with a smaller footprint.",
    agencyId: "o-northwind", endClientId: "o-aurora",
    contacts: [{ contactId: "c1", role: "Producer" }, { contactId: "c3", role: "Decision maker" }, { contactId: "c2", role: "Accounts" }],
    source: "Agency call (outbound)", owner: "amira", createdBy: "amira", company: "uae", currency: "AED", value: 185000, budgetNote: "Agency indicated 170–200k",
    stage: "proposal_sent", createdAt: "2026-10-01", firstResponseAt: "2026-10-01T15:10",
    eventStart: "2026-11-26", eventEnd: "2026-11-28", installStart: "2026-11-23", location: "Dubai Design District, Dubai",
    technologies: T("Floor projection|Motion tracking|Show control"),
    scope: "One 8×5 m floor projection zone, two interactive game modes, branded visuals, on-site operator for three days.",
    exclusions: "Venue power upgrades, content licensing, overnight security.",
    availability: { state: "confirmed", by: "karim", at: "2026-10-12T10:20", notes: "Two projectors and one tracking kit can be held for 23–29 Nov." },
    waiting: "client", paymentTerms: null, risks: T("Venue ceiling height not yet confirmed"),
  },
  {
    id: "42", ref: "OPP-2026-0042", title: "LED tunnel — mall activation",
    brief: "Walk-through LED tunnel for a shopping-mall brand activation. No dates or budget shared yet.",
    agencyId: "o-brightpoint", endClientId: "o-delta",
    contacts: [{ contactId: "c4", role: "Producer" }],
    source: "Referral", owner: "daniel", createdBy: "daniel", company: "uae", currency: "AED", value: null, budgetNote: null,
    stage: "new", createdAt: "2026-10-18", firstResponseAt: null,
    eventStart: null, eventEnd: null, installStart: null, location: "Sharjah (venue not confirmed)",
    technologies: T("LED tunnel"), scope: "To be defined on the qualification call.", exclusions: "—",
    availability: { state: "unverified" }, waiting: null, paymentTerms: null, risks: [],
  },
  {
    id: "43", ref: "OPP-2026-0043", title: "Museum augmented-reality guide",
    brief: "AR-assisted gallery guide for a new permanent exhibition. Client has a budget range and an opening date.",
    agencyId: null, endClientId: "o-pinecrest",
    contacts: [{ contactId: "c6", role: "Decision maker" }],
    source: "Website enquiry", owner: "lena", createdBy: "lena", company: "ksa", currency: "SAR", value: 320000, budgetNote: "Client stated about SAR 300k",
    stage: "qualified", createdAt: "2026-10-12", firstResponseAt: "2026-10-12T14:00",
    eventStart: "2026-12-14", eventEnd: null, installStart: "2026-12-07", location: "Riyadh",
    technologies: T("AR experience|Tablet fleet|Wayfinding beacons"),
    scope: "Twelve AR points across four galleries, content authoring tools for the museum team.",
    exclusions: "Exhibition build, Arabic voice-over recording.",
    availability: { state: "awaiting", requestedBy: "lena", requestedAt: "2026-10-17T11:00" },
    waiting: "internal", paymentTerms: null, risks: T("Opening date fixed by the client"),
  },
  {
    id: "44", ref: "OPP-2026-0044", title: "Immersive dome — hospitality gala",
    brief: "Inflatable immersive dome for a hospitality gala evening. Proposal deck still being drafted.",
    agencyId: "o-meridian", endClientId: "o-solis",
    contacts: [{ contactId: "c7", role: "Producer" }, { contactId: "c8", role: "Decision maker" }],
    source: "LinkedIn", owner: "amira", createdBy: "amira", company: "uae", currency: "AED", value: 240000, budgetNote: "Our estimate; client has not stated a budget",
    stage: "proposal_prep", createdAt: "2026-10-05", firstResponseAt: "2026-10-05T16:30",
    eventStart: "2026-11-05", eventEnd: "2026-11-07", installStart: "2026-11-03", location: "Abu Dhabi",
    technologies: T("Immersive dome|Spatial audio|Show control"),
    scope: "10 m dome, 12-minute immersive show, two operators.", exclusions: "Venue floor levelling.",
    availability: { state: "unverified" }, waiting: null, paymentTerms: null, risks: T("Install in 15 days with no availability confirmation"),
  },
  {
    id: "45", ref: "OPP-2026-0045", title: "Motion-tracked mirror — pharma congress",
    brief: "Interactive mirror feature for a congress networking area. Client has asked to revise payment terms.",
    agencyId: "o-northwind", endClientId: "o-helix",
    contacts: [{ contactId: "c1", role: "Producer" }, { contactId: "c9", role: "Decision maker" }],
    source: "WhatsApp", owner: "daniel", createdBy: "daniel", company: "eu", currency: "EUR", value: 62000, budgetNote: null,
    stage: "negotiation", createdAt: "2026-09-21", firstResponseAt: "2026-09-21T12:20",
    eventStart: "2027-01-18", eventEnd: "2027-01-20", installStart: "2027-01-15", location: "Berlin",
    technologies: T("Motion-tracked mirror|Photo capture"), scope: "Two mirror stations, branded UI, photo share by QR.",
    exclusions: "Travel for client staff.",
    availability: { state: "confirmed", by: "karim", at: "2026-10-02T09:00", notes: "Two mirror units reserved for 12–22 Jan." },
    waiting: "client", paymentTerms: "Client proposes 30% on order, 70% after the event (under discussion)", risks: T("Payment terms differ from standard"),
  },
  {
    id: "46", ref: "OPP-2026-0046", title: "Interactive wall — flagship branch",
    brief: "Interactive wall for a bank flagship branch. Quote has been sent; confirming it arrived.",
    agencyId: null, endClientId: "o-lumen",
    contacts: [{ contactId: "c10", role: "Decision maker" }],
    source: "Instagram", owner: "lena", createdBy: "lena", company: "ksa", currency: "SAR", value: 118000, budgetNote: null,
    stage: "quote_sent", createdAt: "2026-10-03", firstResponseAt: "2026-10-03T10:45",
    eventStart: null, eventEnd: null, installStart: "2026-12-02", location: "Jeddah",
    technologies: T("Interactive wall|Touch overlay"), scope: "One 4 m interactive wall with six content scenes.", exclusions: "Wall construction.",
    availability: { state: "confirmed", by: "karim", at: "2026-10-09T16:10", notes: "Wall unit available from 25 Nov." },
    waiting: "client", paymentTerms: "50% on order, 50% on handover", risks: [],
  },
  {
    id: "47", ref: "OPP-2026-0047", title: "Holographic display — expo stand",
    brief: "Holographic product display for a technology expo stand.",
    agencyId: "o-meridian", endClientId: "o-orbit",
    contacts: [{ contactId: "c7", role: "Producer" }, { contactId: "c11", role: "Decision maker" }],
    source: "Referral", owner: "amira", createdBy: "amira", company: "uae", currency: "AED", value: 96000, budgetNote: null,
    stage: "won", createdAt: "2026-09-02", firstResponseAt: "2026-09-02T13:00",
    eventStart: "2026-11-10", eventEnd: "2026-11-12", installStart: "2026-11-08", location: "Dubai World Trade Centre",
    technologies: T("Holographic display|Show control"), scope: "One holographic cabinet, four product loops, two operators.", exclusions: "Stand construction.",
    availability: { state: "confirmed", by: "karim", at: "2026-09-18T11:30", notes: "Cabinet reserved 6–14 Nov." },
    waiting: null, closedAt: "2026-10-09", evidence: { type: "Purchase order", reference: "PO-88231 (sample)", date: "2026-10-09" },
    handover: "prepared", paymentTerms: "50% on order, 50% within 30 days of event", risks: T("Content approval needed by 1 Nov"),
  },
  {
    id: "48", ref: "OPP-2026-0048", title: "Kinetic sculpture — marina opening",
    brief: "Kinetic light sculpture for a marina opening ceremony.",
    agencyId: null, endClientId: "o-harbour",
    contacts: [{ contactId: "c12", role: "Decision maker" }],
    source: "Website enquiry", owner: "daniel", createdBy: "daniel", company: "eu", currency: "EUR", value: 48000, budgetNote: null,
    stage: "won", createdAt: "2026-09-14", firstResponseAt: "2026-09-14T09:40",
    eventStart: "2026-12-12", eventEnd: "2026-12-12", installStart: "2026-12-09", location: "Valletta",
    technologies: T("Kinetic sculpture|Lighting control"), scope: "One kinetic sculpture, timed to the opening ceremony.", exclusions: "Crane hire.",
    availability: { state: "unverified" }, waiting: null, closedAt: "2026-10-02",
    evidence: { type: "Authorised email", reference: "Email from J. Camilleri (sample)", date: "2026-10-02" },
    handover: null, paymentTerms: "100% on order", risks: T("Technology availability not yet confirmed"),
  },
  {
    id: "49", ref: "OPP-2026-0049", title: "LED floor — dealer event",
    brief: "LED floor for a dealer event.", agencyId: "o-northwind", endClientId: "o-crest",
    contacts: [{ contactId: "c1", role: "Producer" }], source: "Agency call (outbound)", owner: "amira", createdBy: "amira",
    company: "uae", currency: "AED", value: 130000, budgetNote: null, stage: "lost", createdAt: "2026-09-08", firstResponseAt: "2026-09-08T11:00",
    eventStart: "2026-10-30", eventEnd: "2026-10-31", installStart: null, location: "Dubai", technologies: T("LED floor"),
    scope: "—", exclusions: "—", availability: { state: "unavailable", by: "karim", at: "2026-09-12T10:00", alternative: "Smaller 6×4 m floor offered" },
    waiting: null, lostReason: "Budget lower than scope", closedAt: "2026-10-06", paymentTerms: null, risks: [],
  },
  {
    id: "50", ref: "OPP-2026-0050", title: "Sensor garden — resort",
    brief: "Interactive sensor garden for a resort.", agencyId: null, endClientId: "o-verde",
    contacts: [], source: "Direct client", owner: "lena", createdBy: "lena",
    company: "ksa", currency: "SAR", value: 210000, budgetNote: null, stage: "lost", createdAt: "2026-08-20", firstResponseAt: "2026-08-21T09:00",
    eventStart: null, eventEnd: null, installStart: null, location: "AlUla", technologies: T("Sensor garden"),
    scope: "—", exclusions: "—", availability: { state: "unverified" }, waiting: null,
    lostReason: "Went with another supplier", closedAt: "2026-09-22", paymentTerms: null, risks: [],
  },
  {
    id: "51", ref: "OPP-2026-0051", title: "Gesture wall — dealership",
    brief: "Gesture-controlled wall for a dealership; event postponed by the client.", agencyId: "o-brightpoint", endClientId: "o-atlas",
    contacts: [{ contactId: "c4", role: "Producer" }], source: "Agency call (outbound)", owner: "lena", createdBy: "lena",
    company: "uae", currency: "AED", value: 77000, budgetNote: null, stage: "on_hold", createdAt: "2026-09-25", firstResponseAt: "2026-09-25T15:00",
    eventStart: null, eventEnd: null, installStart: null, location: "Dubai", technologies: T("Gesture wall"),
    scope: "—", exclusions: "—", availability: { state: "unverified" }, waiting: "client",
    holdReason: "Client postponed event", holdReview: "2026-11-02", paymentTerms: null, risks: [],
  },
  {
    id: "52", ref: "OPP-2026-0052", title: "Projection mapping — heritage fort night",
    brief: "Projection mapping show on a historic fort wall.", agencyId: null, endClientId: "o-heritage",
    contacts: [], source: "Direct client", owner: "daniel", createdBy: "daniel",
    company: "ksa", currency: "SAR", value: 450000, budgetNote: "Rough figure from first call", stage: "qualified", createdAt: "2026-10-09", firstResponseAt: "2026-10-09T17:20",
    eventStart: "2027-02-06", eventEnd: "2027-02-08", installStart: "2027-02-01", location: "Diriyah", technologies: T("Projection mapping|Spatial audio"),
    scope: "Façade projection show, 8 minutes, nightly.", exclusions: "Scaffolding.",
    availability: { state: "awaiting", requestedBy: "daniel", requestedAt: "2026-10-16T12:00" }, waiting: null, paymentTerms: null, risks: T("Site access windows unknown"),
  },
  {
    id: "53", ref: "OPP-2026-0053", title: "Interactive kiosk set — airport lounge",
    brief: "Four interactive kiosks for an airport lounge refresh.", agencyId: "o-meridian", endClientId: "o-skyline",
    contacts: [{ contactId: "c7", role: "Producer" }], source: "LinkedIn", owner: "amira", createdBy: "amira",
    company: "eu", currency: "EUR", value: 29500, budgetNote: null, stage: "proposal_sent", createdAt: "2026-10-07", firstResponseAt: "2026-10-07T13:30",
    eventStart: null, eventEnd: null, installStart: null, location: "Frankfurt", technologies: T("Interactive kiosks"),
    scope: "Four kiosks, content CMS.", exclusions: "Kiosk enclosures.", availability: { state: "unverified" }, waiting: "client",
    paymentTerms: null, risks: [],
  },
  {
    id: "54", ref: "OPP-2026-0054", title: "Light installation — atrium",
    brief: "Hanging light installation for a retail atrium.", agencyId: null, endClientId: "o-palm",
    contacts: [], source: "Agency call (outbound)", owner: "amira", createdBy: "amira",
    company: "uae", currency: "AED", value: null, budgetNote: null, stage: "new", createdAt: "2026-10-16", firstResponseAt: "2026-10-16T14:00",
    eventStart: null, eventEnd: null, installStart: null, location: "Dubai", technologies: T("Light installation"),
    scope: "To be defined.", exclusions: "—", availability: { state: "unverified" }, waiting: null, paymentTerms: null, risks: [],
  },
];
export const oppByRef = (ref: string) => OPPORTUNITIES.find((o) => o.ref === ref);
export const isOpen = (o: Opportunity) => o.stage !== "won" && o.stage !== "lost";

export interface FollowUp { id: string; oppId: string; owner: PersonId; title: string; due: string; scheduledAt: string; doneAt?: string; kind: "call" | "email" | "meeting" | "proposal" | "other" }
export const FOLLOWUPS: FollowUp[] = [
  { id: "f1", oppId: "41", owner: "amira", title: "Chase client on proposal v2", due: "2026-10-16", scheduledAt: "2026-10-14T16:00", kind: "email" },
  { id: "f2", oppId: "42", owner: "daniel", title: "Call to qualify and ask for dates", due: "2026-10-19", scheduledAt: "2026-10-18T16:45", kind: "call" },
  { id: "f3", oppId: "43", owner: "lena", title: "Send discovery questions", due: "2026-10-20", scheduledAt: "2026-10-17T11:05", kind: "email" },
  { id: "f4", oppId: "44", owner: "amira", title: "Finish proposal draft", due: "2026-10-17", scheduledAt: "2026-10-12T09:00", kind: "proposal" },
  { id: "f5", oppId: "45", owner: "daniel", title: "Reply to revised payment terms", due: "2026-10-23", scheduledAt: "2026-10-16T10:00", kind: "email" },
  { id: "f6", oppId: "46", owner: "lena", title: "Confirm quote was received", due: "2026-10-19", scheduledAt: "2026-10-15T15:00", kind: "call" },
  { id: "f7", oppId: "51", owner: "lena", title: "Review hold — ask client for new date", due: "2026-11-02", scheduledAt: "2026-10-05T10:00", kind: "call" },
  { id: "f8", oppId: "52", owner: "daniel", title: "Site-visit planning call", due: "2026-10-22", scheduledAt: "2026-10-16T12:10", kind: "call" },
  { id: "f9", oppId: "53", owner: "amira", title: "Check in on proposal", due: "2026-10-26", scheduledAt: "2026-10-12T09:00", kind: "email" },
  { id: "f10", oppId: "54", owner: "amira", title: "Qualification call", due: "2026-10-20", scheduledAt: "2026-10-16T14:05", kind: "call" },
  { id: "f11", oppId: "41", owner: "amira", title: "Send proposal v2", due: "2026-10-14", scheduledAt: "2026-10-13T17:00", doneAt: "2026-10-14T11:20", kind: "proposal" },
  { id: "f12", oppId: "46", owner: "lena", title: "Send quote", due: "2026-10-15", scheduledAt: "2026-10-12T10:00", doneAt: "2026-10-15T14:05", kind: "proposal" },
];
export const openFollowUps = () => FOLLOWUPS.filter((f) => !f.doneAt);
export const nextActionOf = (oppId: string) => openFollowUps().filter((f) => f.oppId === oppId).sort((a, b) => a.due.localeCompare(b.due))[0] ?? null;

export interface Activity { id: string; oppId: string; type: "call" | "email" | "meeting" | "note" | "client_response"; at: string; by: PersonId; text: string; internal: boolean }
export const ACTIVITIES: Activity[] = [
  { id: "a1", oppId: "41", type: "call", at: "2026-10-01T15:10", by: "amira", text: "Intro call with Hana. Wants a floor-projection game; launch late November.", internal: false },
  { id: "a2", oppId: "41", type: "note", at: "2026-10-02T09:30", by: "amira", text: "Budget probably 170–200k. Ask about ceiling height before sizing projectors.", internal: true },
  { id: "a3", oppId: "41", type: "email", at: "2026-10-08T12:00", by: "amira", text: "Sent proposal v1 (PDF link).", internal: false },
  { id: "a4", oppId: "41", type: "client_response", at: "2026-10-12T17:40", by: "amira", text: "Client replied: likes the concept, wants a smaller footprint option.", internal: false },
  { id: "a5", oppId: "41", type: "email", at: "2026-10-14T11:20", by: "amira", text: "Sent proposal v2 with the smaller footprint option.", internal: false },
  { id: "a6", oppId: "45", type: "client_response", at: "2026-10-16T09:50", by: "daniel", text: "Client asks for 30% on order and 70% after the event.", internal: false },
  { id: "a7", oppId: "45", type: "note", at: "2026-10-16T10:30", by: "daniel", text: "Standard is 50/50. Needs a founder's view before replying.", internal: true },
  { id: "a8", oppId: "46", type: "email", at: "2026-10-15T14:05", by: "lena", text: "Sent quote reference from Zoho Books.", internal: false },
  { id: "a9", oppId: "43", type: "call", at: "2026-10-12T14:00", by: "lena", text: "Qualified: budget about SAR 300k, opening 14 December.", internal: false },
  { id: "a10", oppId: "47", type: "client_response", at: "2026-10-09T10:10", by: "amira", text: "Purchase order received from Meridian Live.", internal: false },
  { id: "a11", oppId: "44", type: "note", at: "2026-10-12T09:10", by: "amira", text: "Waiting on dome vendor pricing before finalising the deck.", internal: true },
  { id: "a12", oppId: "42", type: "note", at: "2026-10-18T16:40", by: "daniel", text: "Enquiry logged after referral message. No dates, no budget.", internal: true },
];

export interface ProposalVersion {
  id: string; oppId: string; version: number; author: PersonId; date: string; status: "draft" | "sent" | "superseded" | "accepted";
  file: string; note: string;
}
export const PROPOSALS: ProposalVersion[] = [
  { id: "p1", oppId: "41", version: 1, author: "amira", date: "2026-10-08", status: "superseded", file: "Secure link: proposal-v1.pdf (sample)", note: "Original concept, 8×5 m." },
  { id: "p2", oppId: "41", version: 2, author: "amira", date: "2026-10-14", status: "sent", file: "Secure link: proposal-v2.pdf (sample)", note: "Adds smaller 6×4 m option." },
  { id: "p3", oppId: "45", version: 3, author: "daniel", date: "2026-10-09", status: "sent", file: "Secure link: proposal-v3.pdf (sample)", note: "Includes photo-share module." },
  { id: "p4", oppId: "46", version: 1, author: "lena", date: "2026-10-15", status: "sent", file: "Secure link: proposal-v1.pdf (sample)", note: "Single-scene wall." },
  { id: "p5", oppId: "47", version: 2, author: "amira", date: "2026-09-28", status: "accepted", file: "Secure link: proposal-v2.pdf (sample)", note: "Accepted by PO-88231 (sample)." },
  { id: "p6", oppId: "44", version: 1, author: "amira", date: "2026-10-12", status: "draft", file: "Not uploaded yet", note: "Draft in progress." },
  { id: "p7", oppId: "53", version: 1, author: "amira", date: "2026-10-12", status: "sent", file: "Secure link: proposal-v1.pdf (sample)", note: "Four-kiosk option." },
];

export interface ZohoRef { oppId: string; quoteRef: string | null; quoteSentOn: string | null; invoiceRef: string | null; invoiceIssuedOn: string | null; paymentReceivedOn: string | null; paidAmount: number | null }
export const ZOHO: ZohoRef[] = [
  { oppId: "41", quoteRef: "QT-sample-1187", quoteSentOn: "2026-10-14", invoiceRef: null, invoiceIssuedOn: null, paymentReceivedOn: null, paidAmount: null },
  { oppId: "45", quoteRef: "QT-sample-1179", quoteSentOn: "2026-10-09", invoiceRef: null, invoiceIssuedOn: null, paymentReceivedOn: null, paidAmount: null },
  { oppId: "46", quoteRef: "QT-sample-1190", quoteSentOn: "2026-10-15", invoiceRef: null, invoiceIssuedOn: null, paymentReceivedOn: null, paidAmount: null },
  { oppId: "47", quoteRef: "QT-sample-1162", quoteSentOn: "2026-09-28", invoiceRef: "INV-sample-1203", invoiceIssuedOn: "2026-10-12", paymentReceivedOn: null, paidAmount: null },
  { oppId: "48", quoteRef: "QT-sample-1171", quoteSentOn: "2026-09-30", invoiceRef: null, invoiceIssuedOn: null, paymentReceivedOn: null, paidAmount: null },
];
export const zohoFor = (oppId: string) => ZOHO.find((z) => z.oppId === oppId) ?? null;

export interface HistoryEntry { at: string; by: string; what: string }
export const HISTORY: Record<string, HistoryEntry[]> = {
  "41": [
    { at: "2026-10-01T15:00", by: "amira", what: "Created enquiry (source: Agency call). Owner set to Amira Nasser (creator)." },
    { at: "2026-10-02T10:00", by: "amira", what: "Stage New enquiry → Qualified." },
    { at: "2026-10-06T09:00", by: "amira", what: "Stage Qualified → Proposal preparation." },
    { at: "2026-10-08T12:00", by: "amira", what: "Stage Proposal preparation → Proposal sent. Proposal v1 recorded as sent." },
    { at: "2026-10-12T10:20", by: "karim", what: "Availability confirmed with notes." },
    { at: "2026-10-14T11:20", by: "amira", what: "Proposal v2 recorded as sent; v1 superseded." },
  ],
  "47": [
    { at: "2026-10-09T10:15", by: "amira", what: "Marked Won with evidence: Purchase order PO-88231 (sample), dated 2026-10-09." },
    { at: "2026-10-10T08:50", by: "amira", what: "Handover package prepared." },
    { at: "2026-10-12T09:00", by: "amira", what: "Zoho invoice reference INV-sample-1203 recorded (issued 2026-10-12)." },
  ],
};

export interface HandoverPackage {
  oppId: string; acceptedScope: string; exclusions: string; acceptedProposal: string; confirmation: string; technologies: string[];
  dates: string; contacts: { name: string; role: string }[]; paymentTerms: string; risks: string[];
}
export function buildHandover(o: Opportunity): HandoverPackage {
  const latest = PROPOSALS.filter((p) => p.oppId === o.id).sort((a, b) => b.version - a.version)[0];
  return {
    oppId: o.id, acceptedScope: o.scope, exclusions: o.exclusions,
    acceptedProposal: latest ? `Proposal v${latest.version} (${latest.date}) — ${latest.file}` : "No proposal recorded",
    confirmation: o.evidence ? `${o.evidence.type}: ${o.evidence.reference}, dated ${o.evidence.date}` : "No confirmation evidence recorded",
    technologies: o.technologies,
    dates: [o.installStart && `Install from ${o.installStart}`, o.eventStart && `Event ${o.eventStart}${o.eventEnd && o.eventEnd !== o.eventStart ? ` to ${o.eventEnd}` : ""}`].filter(Boolean).join(" · ") || "Dates not recorded",
    contacts: o.contacts.map((c) => ({ name: contactById(c.contactId).name, role: c.role })),
    paymentTerms: o.paymentTerms ?? "Not recorded", risks: o.risks,
  };
}

/** Sales settings as they would be seeded. Response targets, working calendar and thresholds are intentionally EMPTY. */
export const SETTINGS_HISTORY = [
  { at: "2026-09-30T10:00", by: "juzar", what: "Stage label 'Negotiation' renamed from 'Commercial discussion'. Stage id unchanged; earlier reports keep their original label for that period." },
  { at: "2026-09-30T09:40", by: "juzar", what: "Added lost reason 'Technology not available'." },
];

export interface FinanceSampleRow { project: string; currency: Currency; budget: number; committed: number; actual: number; forecast: number; invoiced: number; collected: number }
export const FINANCE_SAMPLE: FinanceSampleRow[] = [
  { project: "Expo holographic stand (sample)", currency: "AED", budget: 52000, committed: 31000, actual: 18500, forecast: 49000, invoiced: 48000, collected: 0 },
  { project: "Showroom launch (sample)", currency: "AED", budget: 98000, committed: 40000, actual: 0, forecast: 96000, invoiced: 0, collected: 0 },
  { project: "Congress mirror (sample)", currency: "EUR", budget: 33000, committed: 9000, actual: 0, forecast: 31000, invoiced: 0, collected: 0 },
];

export const money = (n: number | null, c: Currency) => (n == null ? "Value not set" : `${c} ${n.toLocaleString("en-US")}`);
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000);

export type DueState = "overdue" | "today" | "upcoming" | "done";
export const dueState = (due: string, done?: string): DueState => (done ? "done" : due < TODAY ? "overdue" : due === TODAY ? "today" : "upcoming");

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "Not set";
  const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtDateTime(d: string): string {
  return `${fmtDate(d)}, ${d.slice(11, 16)} GST`;
}
export function relDays(d: string): string {
  const n = dayDiff(d, TODAY);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Attention buckets, all derived from the sample records above. */
export function attention(inScope: (o: Opportunity) => boolean = () => true) {
  const open = OPPORTUNITIES.filter((o) => isOpen(o) && inScope(o));
  const fus = openFollowUps().filter((f) => inScope(oppById(f.oppId)));
  const awaitingFirstResponse = open.filter((o) => !o.firstResponseAt);
  const dueToday = fus.filter((f) => f.due === TODAY && f.kind !== "proposal");
  const overdue = fus.filter((f) => f.due < TODAY);
  const waitingForClient = open.filter((o) => o.waiting === "client" && o.stage !== "on_hold");
  const proposalPrepOverdue = fus.filter((f) => f.kind === "proposal" && f.due < TODAY && oppById(f.oppId).stage === "proposal_prep");
  const installNoConfirmation = open.filter(
    (o) => o.installStart && dayDiff(o.installStart, TODAY) >= 0 && dayDiff(o.installStart, TODAY) <= 21 && o.availability.state !== "confirmed",
  );
  return { awaitingFirstResponse, dueToday, overdue, waitingForClient, proposalPrepOverdue, installNoConfirmation };
}
export const oppById = (id: string) => OPPORTUNITIES.find((o) => o.id === id)!;
