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
  { id: "o-gulf", name: "Gulf Partners Forum", type: "direct", place: "Riyadh, KSA", note: "Direct client." },
];
export const orgById = (id: string) => ORGS.find((o) => o.id === id)!;

export interface Contact { id: string; orgId: string; name: string; role: string; email: string | null; phone: string | null }
export const CONTACTS: Contact[] = [
  { id: "c1", orgId: "o-northwind", name: "Hana Verma", role: "Senior Producer", email: "hana.verma@example.test", phone: "+971 50 000 0101" },
  { id: "c2", orgId: "o-northwind", name: "Marcus Bell", role: "Accounts", email: "marcus.bell@example.test", phone: "+971 50 000 0102" },
  { id: "c3", orgId: "o-aurora", name: "Reem Al Falasi", role: "Marketing Director", email: "reem.alfalasi@example.test", phone: "+971 50 000 0103" },
  { id: "c4", orgId: "o-brightpoint", name: "Yusuf Karimi", role: "Creative Director", email: "yusuf.karimi@example.test", phone: "+971 50 000 0104" },
  { id: "c5", orgId: "o-delta", name: "Noor Haddad", role: "Brand Manager", email: "noor.haddad@example.test", phone: "+971 50 000 0105" },
  { id: "c6", orgId: "o-pinecrest", name: "Dr. Layla Mansour", role: "Head of Exhibitions", email: "layla.mansour@example.test", phone: "+966 50 000 0106" },
  { id: "c7", orgId: "o-meridian", name: "Oliver Grant", role: "Head of Production", email: "oliver.grant@example.test", phone: "+44 20 0000 0107" },
  { id: "c8", orgId: "o-solis", name: "Camille Dupont", role: "Events Lead", email: "camille.dupont@example.test", phone: "+971 50 000 0108" },
  { id: "c9", orgId: "o-helix", name: "Dr. Jonas Weber", role: "Congress Manager", email: "jonas.weber@example.test", phone: null },
  { id: "c10", orgId: "o-lumen", name: "Faisal Rahman", role: "Branch Experience Lead", email: null, phone: "+966 50 000 0110" },
  { id: "c11", orgId: "o-orbit", name: "Mei Lin", role: "Marketing Manager", email: "mei.lin@example.test", phone: "+971 50 000 0111" },
  { id: "c12", orgId: "o-harbour", name: "Joseph Camilleri", role: "Operations Manager", email: "joseph.camilleri@example.test", phone: "+356 0000 0112" },
];
export const contactById = (id: string) => CONTACTS.find((c) => c.id === id)!;

export interface Tech { name: string; qty: number }
/** What an equipment-availability check covered. If any of this changes afterwards, the check needs repeating. */
export interface Snapshot { installStart: string | null; eventStart: string | null; eventEnd: string | null; tech: Tech[] }
export type Availability =
  | { state: "unverified" }
  | { state: "awaiting"; requestedBy: string; requestedAt: string }
  | { state: "confirmed"; by: string; at: string; notes: string; covers?: Snapshot }
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
  technologies: Tech[];
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
  prepStart?: string | null;
  dismantle?: string | null;
  returnBy?: string | null;
}

const L = (s: string) => s.split("|");
const T = (s: string): Tech[] => s.split("|").map((name) => ({ name, qty: 1 }));

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
    waiting: "client", paymentTerms: null, risks: L("Venue ceiling height not yet confirmed"),
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
    waiting: "internal", paymentTerms: null, risks: L("Opening date fixed by the client"),
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
    availability: { state: "unverified" }, waiting: null, paymentTerms: null, risks: L("Install in 15 days with no availability confirmation"),
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
    waiting: "client", paymentTerms: "Client proposes 30% on order, 70% after the event (under discussion)", risks: L("Payment terms differ from standard"),
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
    handover: "prepared", paymentTerms: "50% on order, 50% within 30 days of event", risks: L("Content approval needed by 1 Nov"),
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
    handover: null, paymentTerms: "100% on order", risks: L("Technology availability not yet confirmed"),
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
    availability: { state: "awaiting", requestedBy: "daniel", requestedAt: "2026-10-16T12:00" }, waiting: null, paymentTerms: null, risks: L("Site access windows unknown"),
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
  {
    id: "55", ref: "OPP-2026-0055", title: "Interactive multi-zone brand experience for the annual regional partner summit and awards gala dinner",
    brief: "Several linked interactive zones across a three-day partner summit, ending with a gala dinner reveal. Client is still deciding which zones they want.",
    agencyId: null, endClientId: "o-gulf", contacts: [], source: "Website enquiry", owner: "lena", createdBy: "lena",
    company: "ksa", currency: "SAR", value: null, budgetNote: "Client asked us to propose options", stage: "qualified", createdAt: "2026-10-19", firstResponseAt: "2026-10-19T08:55",
    eventStart: "2027-03-04", eventEnd: "2027-03-06", installStart: "2027-03-01", location: "Riyadh International Convention Centre, Riyadh",
    technologies: T("Interactive wall|Projection mapping|Motion tracking"),
    scope: "To be defined once the client chooses zones.", exclusions: "—", availability: { state: "unverified" }, waiting: null, paymentTerms: null, risks: L("Scope and budget still open"),
  },
];
export const oppByRef = (ref: string) => OPPORTUNITIES.find((o) => o.ref === ref);
export const isOpen = (o: Opportunity) => o.stage !== "won" && o.stage !== "lost";

/** One primary deadline (`dueAt`, Dubai time). `createdAt` and `doneAt` are secondary, kept for history. */
export interface FollowUp { id: string; oppId: string; owner: PersonId; title: string; dueAt: string; createdAt: string; doneAt?: string; kind: "call" | "email" | "meeting" | "proposal" | "other"; outcome?: string }
export const FOLLOWUPS: FollowUp[] = [
  { id: "f1", oppId: "41", owner: "amira", title: "Chase client on proposal v2", dueAt: "2026-10-16T16:00", createdAt: "2026-10-14T11:25", kind: "email" },
  { id: "f2", oppId: "42", owner: "daniel", title: "Call to qualify and ask for dates", dueAt: "2026-10-19T11:00", createdAt: "2026-10-18T16:45", kind: "call" },
  { id: "f3", oppId: "43", owner: "lena", title: "Send discovery questions", dueAt: "2026-10-20T10:00", createdAt: "2026-10-17T11:05", kind: "email" },
  { id: "f4", oppId: "44", owner: "amira", title: "Finish proposal draft", dueAt: "2026-10-17T12:00", createdAt: "2026-10-12T09:00", kind: "proposal" },
  { id: "f5", oppId: "45", owner: "daniel", title: "Reply to revised payment terms", dueAt: "2026-10-23T11:00", createdAt: "2026-10-16T10:00", kind: "email" },
  { id: "f6", oppId: "46", owner: "lena", title: "Confirm quote was received", dueAt: "2026-10-19T15:00", createdAt: "2026-10-15T15:00", kind: "call" },
  { id: "f7", oppId: "51", owner: "lena", title: "Review hold and ask client for a new date", dueAt: "2026-11-02T10:00", createdAt: "2026-10-05T10:00", kind: "call" },
  { id: "f8", oppId: "52", owner: "daniel", title: "Site-visit planning call", dueAt: "2026-10-22T14:00", createdAt: "2026-10-16T12:10", kind: "call" },
  { id: "f9", oppId: "53", owner: "amira", title: "Check in on proposal", dueAt: "2026-10-26T10:00", createdAt: "2026-10-12T09:00", kind: "email" },
  { id: "f10", oppId: "54", owner: "amira", title: "Qualification call", dueAt: "2026-10-20T15:00", createdAt: "2026-10-16T14:05", kind: "call" },
  { id: "f13", oppId: "55", owner: "lena", title: "Send discovery questions for the summit", dueAt: "2026-10-21T10:00", createdAt: "2026-10-19T08:50", kind: "email" },
  { id: "f11", oppId: "41", owner: "amira", title: "Send proposal v2", dueAt: "2026-10-14T12:00", createdAt: "2026-10-13T17:00", doneAt: "2026-10-14T11:20", kind: "proposal", outcome: "Proposal v2 sent by email." },
  { id: "f12", oppId: "46", owner: "lena", title: "Send quote", dueAt: "2026-10-15T16:00", createdAt: "2026-10-12T10:00", doneAt: "2026-10-15T14:05", kind: "proposal", outcome: "Quote reference shared with the client." },
];
export const openFollowUps = () => FOLLOWUPS.filter((f) => !f.doneAt);
export const nextActionOf = (oppId: string) => openFollowUps().filter((f) => f.oppId === oppId).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null;

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
  kind: "file" | "link"; fileName?: string; sizeKb?: number; url?: string; sentOn?: string; note: string;
}
export const PROPOSALS: ProposalVersion[] = [
  { id: "p1", oppId: "41", version: 1, author: "amira", date: "2026-10-07", status: "superseded", kind: "file", fileName: "showroom-floor-v1.pdf", sizeKb: 1480, sentOn: "2026-10-08", note: "Original concept, 8×5 m." },
  { id: "p2", oppId: "41", version: 2, author: "amira", date: "2026-10-14", status: "sent", kind: "link", url: "https://www.canva.com/design/sample-showroom-v2", sentOn: "2026-10-14", note: "Adds a smaller 6×4 m option." },
  { id: "p3", oppId: "45", version: 3, author: "daniel", date: "2026-10-09", status: "sent", kind: "file", fileName: "mirror-congress-v3.pdf", sizeKb: 2210, sentOn: "2026-10-09", note: "Includes the photo-share module." },
  { id: "p4", oppId: "46", version: 1, author: "lena", date: "2026-10-15", status: "sent", kind: "file", fileName: "interactive-wall-v1.pdf", sizeKb: 960, sentOn: "2026-10-15", note: "Single-scene wall." },
  { id: "p5", oppId: "47", version: 2, author: "amira", date: "2026-09-28", status: "accepted", kind: "file", fileName: "holographic-expo-v2.pdf", sizeKb: 1730, sentOn: "2026-09-28", note: "Accepted by PO-88231 (sample)." },
  { id: "p6", oppId: "44", version: 1, author: "amira", date: "2026-10-17", status: "draft", kind: "file", fileName: "dome-gala-draft.pptx", sizeKb: 5120, note: "Draft in progress; waiting for dome vendor pricing." },
  { id: "p7", oppId: "53", version: 1, author: "amira", date: "2026-10-12", status: "sent", kind: "link", url: "https://drive.example.test/sample-kiosks-v1", sentOn: "2026-10-12", note: "Four-kiosk option." },
];
export const proposalSource = (p: ProposalVersion) => (p.kind === "file" ? (p.fileName ?? "No file added yet") : (p.url ? new URL(p.url).host : "No link added yet"));

/** Commercial approval. Policy is set per owning company by authorised founders; nothing here invents thresholds or approvers. */
export type ApprovalPolicy = "not_configured" | "not_required" | "required";
export const APPROVAL_POLICY: Record<CompanyId, { policy: ApprovalPolicy; note: string }> = {
  uae: { policy: "required", note: "Set by the founders. The scope of what needs approval is not defined yet." },
  ksa: { policy: "not_configured", note: "Nobody has decided yet." },
  eu: { policy: "not_required", note: "The founders decided no approval is needed." },
};
export type ApprovalState = "pending" | "approved" | "changes_requested";
export interface ApprovalRecord { oppId: string; version: number; state: ApprovalState; requestedBy: PersonId; requestedAt: string; decidedBy?: PersonId; decidedAt?: string; instruction?: string }
export const APPROVAL_RECORDS: ApprovalRecord[] = [
  { oppId: "41", version: 1, state: "changes_requested", requestedBy: "amira", requestedAt: "2026-10-07T15:00", decidedBy: "rafi", decidedAt: "2026-10-08T09:30", instruction: "Reduce the second-tier scope, then resend for approval." },
  { oppId: "44", version: 1, state: "pending", requestedBy: "amira", requestedAt: "2026-10-17T17:00" },
  { oppId: "47", version: 2, state: "approved", requestedBy: "amira", requestedAt: "2026-09-26T11:00", decidedBy: "juzar", decidedAt: "2026-09-27T10:15", instruction: "Approved at the quoted price." },
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
    { at: "2026-10-12T10:20", by: "karim", what: "Equipment availability check recorded (dates, technologies and quantities noted)." },
    { at: "2026-10-14T11:20", by: "amira", what: "Proposal v2 recorded as sent; v1 superseded." },
  ],
  "47": [
    { at: "2026-10-09T10:15", by: "amira", what: "Marked Won with evidence: Purchase order PO-88231 (sample), dated 2026-10-09." },
    { at: "2026-10-10T08:50", by: "amira", what: "Handover package prepared." },
    { at: "2026-10-12T09:00", by: "amira", what: "Zoho invoice reference INV-sample-1203 recorded (issued 2026-10-12)." },
  ],
};

export interface HandoverPackage {
  oppId: string; acceptedScope: string; exclusions: string; acceptedProposal: string; confirmation: string; technologies: Tech[];
  dates: string; contacts: { name: string; role: string }[]; paymentTerms: string; risks: string[];
}
export function buildHandover(o: Opportunity): HandoverPackage {
  const latest = PROPOSALS.filter((p) => p.oppId === o.id).sort((a, b) => b.version - a.version)[0];
  return {
    oppId: o.id, acceptedScope: o.scope, exclusions: o.exclusions,
    acceptedProposal: latest ? `Proposal v${latest.version} (${fmtDate(latest.date)}), ${proposalSource(latest)}` : "No proposal recorded",
    confirmation: o.evidence ? `${o.evidence.type}: ${o.evidence.reference}, dated ${fmtDate(o.evidence.date)}` : "No confirmation evidence recorded",
    technologies: o.technologies,
    dates: fmtSchedule(o) || "Dates not confirmed",
    contacts: o.contacts.map((c) => ({ name: contactById(c.contactId).name, role: c.role })),
    paymentTerms: o.paymentTerms ?? "Not recorded", risks: o.risks,
  };
}

/** Sales settings as they would be seeded. Response targets, working calendar and thresholds are intentionally EMPTY. */
export const SETTINGS_HISTORY = [
  { at: "2026-09-30T10:00", by: "juzar", what: "Stage label 'Negotiation' renamed from 'Commercial discussion'. Stage id unchanged; earlier reports keep their original label for that period." },
  { at: "2026-09-30T09:40", by: "juzar", what: "Added lost reason 'Technology not available'." },
];

/**
 * Future reporting example (sample figures). Seven different things, kept apart:
 * an advance is cash issued, not a cost; a cost can be incurred but unpaid; one expense is one cost, however many receipts,
 * card transactions or accounting entries describe it.
 */
export interface FinanceSampleRow {
  project: string; currency: Currency; approvedBudget: number; committed: number; incurred: number; forecastFinal: number;
  invoiced: number; collections: number; supplierPayments: number; advancesIssued: number;
}
export const FINANCE_SAMPLE: FinanceSampleRow[] = [
  { project: "Expo holographic stand", currency: "AED", approvedBudget: 52000, committed: 31000, incurred: 18500, forecastFinal: 49000, invoiced: 48000, collections: 0, supplierPayments: 6000, advancesIssued: 4000 },
  { project: "Marina kinetic sculpture", currency: "EUR", approvedBudget: 30000, committed: 9000, incurred: 0, forecastFinal: 28500, invoiced: 0, collections: 0, supplierPayments: 0, advancesIssued: 0 },
  { project: "Bank lobby wall, phase 2", currency: "SAR", approvedBudget: 64000, committed: 22000, incurred: 11000, forecastFinal: 61000, invoiced: 59000, collections: 29500, supplierPayments: 11000, advancesIssued: 0 },
];

export const money = (n: number | null, c: Currency) => (n == null ? "Value not set" : `${c} ${n.toLocaleString("en-US")}`);
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86400000);
const minutesDiff = (a: string, b: string) => Math.round((Date.parse(`${a}:00Z`) - Date.parse(`${b}:00Z`)) / 60000);

export const TZ_LABEL = "Dubai time";
export const SAMPLE_DATE_LONG = "Monday 19 October 2026";
export const SAMPLE_NOW_LABEL = "Mon 19 Oct 2026, 9:30 am · Dubai time";

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "Not set";
  const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
/** Day and month, adding the year only when it is not the sample year. */
export function fmtDay(d: string): string {
  const dt = new Date(d.slice(0, 10) + "T00:00:00Z");
  const sameYear = d.slice(0, 4) === TODAY.slice(0, 4);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}
export function fmtTime(d: string): string {
  const h = Number(d.slice(11, 13)); const m = d.slice(14, 16);
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "am" : "pm"}`;
}
/** Secondary timestamps (created, completed, history). */
export function fmtDateTime(d: string): string {
  return `${fmtDate(d)}, ${fmtTime(d)} · ${TZ_LABEL}`;
}
/** The one primary deadline format, for example "Due 16 Oct, 4:00 pm · Dubai time". */
export function fmtDue(dueAt: string): string {
  return `Due ${fmtDay(dueAt)}, ${fmtTime(dueAt)} · ${TZ_LABEL}`;
}
export function fmtRange(start: string | null, end: string | null): string {
  if (!start) return "Dates not confirmed";
  if (!end || end === start) return fmtDate(start);
  const [sy, sm] = [start.slice(0, 4), start.slice(5, 7)];
  const sameMonth = sy === end.slice(0, 4) && sm === end.slice(5, 7);
  return sameMonth ? `${Number(start.slice(8, 10))}–${fmtDate(end)}` : `${fmtDate(start)} – ${fmtDate(end)}`;
}
export function fmtSchedule(o: Opportunity): string {
  return [o.installStart && `Install from ${fmtDate(o.installStart)}`, o.eventStart && `Show ${fmtRange(o.eventStart, o.eventEnd ?? null)}`].filter(Boolean).join(" · ");
}
export function relDays(d: string): string {
  const n = dayDiff(d, TODAY);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export type DueState = "overdue" | "today" | "upcoming" | "done";
export const dueState = (dueAt: string, done?: string): DueState =>
  done ? "done" : dueAt < NOW ? "overdue" : dueAt.slice(0, 10) === TODAY ? "today" : "upcoming";
/** "Overdue by 3 days", "Due today", "Due in 4 days". Always derived from the one fixed sample time. */
export function dueLabel(dueAt: string, done?: string): string {
  const s = dueState(dueAt, done);
  if (s === "done") return `Done ${fmtDay(done!)}`;
  if (s === "today") return "Due today";
  if (s === "overdue") {
    const days = dayDiff(TODAY, dueAt);
    if (days >= 1) return `Overdue by ${days} ${days === 1 ? "day" : "days"}`;
    const mins = minutesDiff(NOW, dueAt);
    return mins >= 60 ? `Overdue by ${Math.floor(mins / 60)} h` : `Overdue by ${mins} min`;
  }
  const n = dayDiff(dueAt, TODAY);
  return n === 1 ? "Due tomorrow" : `Due in ${n} days`;
}

// ---- Equipment availability (not a stock reservation: Inventory is not implemented) -------------------------------

export function snapshot(o: Pick<Opportunity, "installStart" | "eventStart" | "eventEnd" | "technologies">): Snapshot {
  return { installStart: o.installStart, eventStart: o.eventStart, eventEnd: o.eventEnd, tech: o.technologies.map((t) => ({ ...t })) };
}
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function coverageText(s: Snapshot): string {
  const dates = s.installStart || s.eventStart ? [s.installStart && `install ${fmtDate(s.installStart)}`, s.eventStart && `show ${fmtRange(s.eventStart, s.eventEnd)}`].filter(Boolean).join(", ") : "no dates recorded";
  return `${dates}; ${s.tech.map((t) => `${t.name} ×${t.qty}`).join(", ") || "no technologies"}`;
}

// ---- Sample refinements applied once, after the base records are defined ------------------------------------------

const QTY: Record<string, Record<string, number>> = {
  "41": { "Floor projection": 2, "Motion tracking": 1, "Show control": 1 },
  "45": { "Motion-tracked mirror": 2, "Photo capture": 2 },
  "46": { "Interactive wall": 1, "Touch overlay": 1 },
  "47": { "Holographic display": 1, "Show control": 1 },
  "53": { "Interactive kiosks": 4 },
};
const EXTRA_DATES: Record<string, { prepStart: string; dismantle: string; returnBy: string }> = {
  "41": { prepStart: "2026-11-16", dismantle: "2026-11-29", returnBy: "2026-12-01" },
  "45": { prepStart: "2027-01-05", dismantle: "2027-01-21", returnBy: "2027-01-28" },
  "47": { prepStart: "2026-11-02", dismantle: "2026-11-12", returnBy: "2026-11-14" },
};
for (const o of OPPORTUNITIES) {
  for (const t of o.technologies) t.qty = QTY[o.id]?.[t.name] ?? t.qty;
  Object.assign(o, EXTRA_DATES[o.id] ?? {});
  if (o.availability.state === "confirmed") o.availability.covers = snapshot(o);
}

// ---- Attention buckets (everything derived from the records and the fixed sample time) -----------------------------

export const INSTALL_WINDOW_DAYS = 45;
export type CommercialStatus = "Commercially won" | "Not commercially confirmed";
export const commercialStatus = (o: Opportunity): CommercialStatus => (o.stage === "won" && o.evidence ? "Commercially won" : "Not commercially confirmed");
export function equipmentOk(o: Opportunity): boolean {
  return o.availability.state === "confirmed" && !!o.availability.covers && sameSnapshot(o.availability.covers, snapshot(o));
}

export function attention(inScope: (o: Opportunity) => boolean = () => true) {
  const open = OPPORTUNITIES.filter((o) => isOpen(o) && inScope(o));
  const fus = openFollowUps().filter((f) => inScope(oppById(f.oppId)));
  const awaitingFirstResponse = open.filter((o) => !o.firstResponseAt);
  const dueToday = fus.filter((f) => dueState(f.dueAt) === "today");
  const overdue = fus.filter((f) => dueState(f.dueAt) === "overdue");
  const waitingForClient = open.filter((o) => o.waiting === "client" && o.stage !== "on_hold");
  const proposalPrepOverdue = overdue.filter((f) => f.kind === "proposal" && oppById(f.oppId).stage === "proposal_prep");
  const installRisks = open
    .filter((o) => o.installStart && dayDiff(o.installStart, TODAY) >= 0 && dayDiff(o.installStart, TODAY) <= INSTALL_WINDOW_DAYS && (commercialStatus(o) !== "Commercially won" || !equipmentOk(o)))
    .sort((a, b) => a.installStart!.localeCompare(b.installStart!));
  return { awaitingFirstResponse, dueToday, overdue, waitingForClient, proposalPrepOverdue, installRisks };
}
export const oppById = (id: string) => OPPORTUNITIES.find((o) => o.id === id)!;
export const approvalRecordsFor = (oppId: string) => APPROVAL_RECORDS.filter((r) => r.oppId === oppId).sort((a, b) => b.version - a.version);
