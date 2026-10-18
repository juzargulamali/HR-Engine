/** FICTIONAL SAMPLE DATA for the later modules (Projects & Tasks, Inventory, Vendors, Approvals). Nothing here exists in the product yet. */
export type Health = "on_track" | "at_risk" | "blocked";
export interface SampleProject { id: string; name: string; client: string; pm: string; install: string; event: string; health: Health; note: string; fromRef?: string }
export const PROJECTS: SampleProject[] = [
  { id: "pr1", name: "Expo holographic stand", client: "Orbit Tech via Meridian Live", pm: "Priya Raman", install: "2026-11-08", event: "2026-11-10", health: "at_risk", note: "Content approval needed by 1 Nov.", fromRef: "OPP-2026-0047" },
  { id: "pr2", name: "Marina kinetic sculpture", client: "Harbour Marina", pm: "Priya Raman", install: "2026-12-09", event: "2026-12-12", health: "on_track", note: "Technology availability not yet confirmed.", fromRef: "OPP-2026-0048" },
  { id: "pr3", name: "Bank lobby wall, phase 2", client: "Lumen Bank", pm: "Priya Raman", install: "2026-11-03", event: "2026-11-04", health: "blocked", note: "Waiting for client network access details.", },
];

export interface SampleTask { id: string; projectId: string; title: string; assignee: string; due: string; status: "todo" | "doing" | "blocked" | "done"; dept: "Programming" | "Content" | "Engineering" }
export const TASKS: SampleTask[] = [
  { id: "t1", projectId: "pr1", title: "Hologram loop 3: final render", assignee: "Tariq Aziz", due: "2026-10-21", status: "doing", dept: "Content" },
  { id: "t2", projectId: "pr1", title: "Show-control cue sheet", assignee: "Nadia Farouk", due: "2026-10-27", status: "todo", dept: "Programming" },
  { id: "t3", projectId: "pr3", title: "Touch calibration build", assignee: "Ibrahim Saad", due: "2026-10-23", status: "blocked", dept: "Programming" },
  { id: "t4", projectId: "pr2", title: "Sculpture motion sequence draft", assignee: "Zeynep Arslan", due: "2026-10-30", status: "todo", dept: "Programming" },
  { id: "t5", projectId: "pr1", title: "Brand colour approval pack", assignee: "Tariq Aziz", due: "2026-10-19", status: "todo", dept: "Content" },
  { id: "t6", projectId: "pr3", title: "Lobby scene 4 illustrations", assignee: "Tariq Aziz", due: "2026-10-26", status: "doing", dept: "Content" },
  { id: "t7", projectId: "pr2", title: "Motion sequence review with the client", assignee: "Zeynep Arslan", due: "2026-10-16", status: "doing", dept: "Programming" },
];

export const WEEK_DAYS = ["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23"] as const;

/**
 * Representative team plan. Office and workshop work can run across several projects on the same day, so several
 * projects on a day is neutral. An empty day only means no allocation is recorded: it does not mean idle or absent.
 * Only confirmed SITE commitments protect time (see SITE_BOOKINGS).
 */
export type AssignmentType = "office" | "workshop" | "site";
export interface Allocation { project: string; type: AssignmentType }
const off = (project: string): Allocation => ({ project, type: "office" });
const shop = (project: string): Allocation => ({ project, type: "workshop" });
export const TEAM_PLAN: { person: string; title: string; days: Allocation[][] }[] = [
  { person: "Nadia Farouk", title: "Programmer", days: [[off("Expo stand")], [off("Expo stand"), off("Bank lobby")], [off("Expo stand"), off("Bank lobby")], [off("Bank lobby")], []] },
  { person: "Ibrahim Saad", title: "Programmer", days: [[off("Bank lobby")], [off("Bank lobby")], [off("Bank lobby"), off("Marina")], [off("Bank lobby")], [off("Marina")]] },
  { person: "Zeynep Arslan", title: "Programmer", days: [[off("Marina")], [off("Marina")], [], [off("Expo stand")], [off("Expo stand"), off("Marina")]] },
  { person: "Selim Doruk", title: "Engineer", days: [[shop("Expo stand"), shop("Marina")], [shop("Expo stand"), shop("Marina")], [shop("Expo stand")], [shop("Marina")], []] },
];
export const multiProjectDays = () => TEAM_PLAN.flatMap((p) => p.days).filter((d) => d.length > 1).length;
export const daysWithoutAllocation = () => TEAM_PLAN.flatMap((p) => p.days).filter((d) => d.length === 0).length;

/** Explicit concerns are raised by a person. They are never inferred from how many projects someone is on. */
export const CAPACITY_CONCERNS = [
  { id: "cc1", raisedBy: "Priya Raman (Project Manager)", at: "2026-10-18T17:20", text: "Show-control cue sheet and Touch calibration build both need Nadia Farouk by 23 Oct. Both client dates are fixed, so one needs a decision." },
];

/** Confirmed physical commitments. These, and only these, block overlapping time, including travel and preparation. */
export interface SiteBooking { id: string; person: string; title: string; project: string; place: string; start: string; end: string; travelMin: number; prepMin: number; confirmed: boolean }
export const SITE_BOOKINGS: SiteBooking[] = [
  { id: "sb1", person: "Nadia Farouk", title: "Programmer", project: "Expo holographic stand", place: "Dubai World Trade Centre", start: "2026-11-08T07:00", end: "2026-11-08T19:00", travelMin: 60, prepMin: 30, confirmed: true },
  { id: "sb2", person: "Nadia Farouk", title: "Programmer", project: "Bank lobby wall, phase 2", place: "Branch in Sharjah", start: "2026-11-08T15:00", end: "2026-11-08T17:00", travelMin: 45, prepMin: 15, confirmed: true },
  { id: "sb3", person: "Ibrahim Saad", title: "Programmer", project: "Expo holographic stand", place: "Dubai World Trade Centre", start: "2026-11-09T08:00", end: "2026-11-09T16:00", travelMin: 60, prepMin: 30, confirmed: true },
];
const mins = (s: string) => Date.parse(`${s}:00Z`) / 60000;
/** The time a site booking protects: preparation and travel before, travel back after. */
export function bookingWindow(b: SiteBooking): { from: number; to: number } {
  return { from: mins(b.start) - b.travelMin - b.prepMin, to: mins(b.end) + b.travelMin };
}
export function siteConflicts(list: SiteBooking[] = SITE_BOOKINGS): { a: SiteBooking; b: SiteBooking }[] {
  const out: { a: SiteBooking; b: SiteBooking }[] = [];
  const conf = list.filter((x) => x.confirmed);
  for (let i = 0; i < conf.length; i++) for (let j = i + 1; j < conf.length; j++) {
    const x = conf[i]!, y = conf[j]!;
    if (x.person !== y.person) continue;
    const wx = bookingWindow(x), wy = bookingWindow(y);
    if (wx.from < wy.to && wy.from < wx.to) out.push({ a: x, b: y });
  }
  return out;
}
export const fmtClock = (m: number) => { const d = new Date(m * 60000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

export const SAMPLE_REQUESTS = {
  advances: [
    { project: "Expo holographic stand", ask: "Expense advance: 3 people × 4 days (travel, meals)", status: "Waiting for Finance" },
    { project: "Marina kinetic sculpture", ask: "Expense advance: not requested yet", status: "Needed before site work" },
  ],
  reservations: [
    { what: "Site assignment: Expo install", when: "Sun 8 Nov, 07:00–19:00", who: "Nadia Farouk, Tariq Aziz", note: "Includes travel and preparation buffer" },
  ],
};

export const INVENTORY_SAMPLE = [
  { item: "Laser projector 12k (unit P-04)", kind: "Technology", location: "Warehouse A", condition: "Good", status: "Reserved 6–14 Nov (Expo stand)" },
  { item: "Motion-tracking kit (K-02)", kind: "Technology", location: "Warehouse A", condition: "Good", status: "Available" },
  { item: "Holographic cabinet (H-01)", kind: "Technology", location: "On site (sample)", condition: "Needs inspection after return", status: "Dispatched" },
  { item: "HDMI-over-IP transmitter ×6", kind: "Components", location: "Warehouse B", condition: "Good", status: "4 available, 2 reserved" },
];

export const VENDORS_SAMPLE = [
  { vendor: "Skyline Rentals (sample)", category: "Equipment rental", status: "Active", note: "Insurance document expires 12 Dec 2026" },
  { vendor: "Granite Logistics (sample)", category: "Freight", status: "Onboarding", note: "Trade licence not uploaded yet" },
  { vendor: "Pixelforge Studio (sample)", category: "Content freelancers", status: "Active", note: "Rate card on file" },
];
export const PURCHASE_REQUESTS_SAMPLE = [
  { ref: "PR-sample-001", what: "Rent 2 × 12k projectors, 6–14 Nov", by: "Priya Raman", type: "Rental request", status: "With Admin", amount: "Quote awaited" },
  { ref: "PR-sample-002", what: "Buy 6 × HDMI transmitters", by: "Karim Saleh", type: "Purchase request", status: "Waiting for approval", amount: "Amount not entered" },
];

export const APPROVALS_SAMPLE = [
  { id: "ap1", kind: "Leave", title: "Annual leave, 2 days (sample)", from: "Zeynep Arslan", when: "Waiting 1 day", module: "People & HR", live: true },
  { id: "ap2", kind: "Expense claim", title: "Client lunch reimbursement (sample)", from: "Nadia Farouk", when: "Waiting 2 days", module: "People & HR", live: true },
  { id: "ap3", kind: "Recovery Leave", title: "Recovery credit for site work, 18 Oct (sample)", from: "Tariq Aziz", when: "Waiting as project lead", module: "People & HR", live: true },
  { id: "ap4", kind: "Commercial approval", title: "OPP-2026-0045 pricing v3 (sample)", from: "Daniel Okafor", when: "Waiting 3 days", module: "Sales & CRM", live: false },
  { id: "ap5", kind: "Purchase request", title: "Buy 6 HDMI transmitters (sample)", from: "Karim Saleh", when: "Waiting 1 day", module: "Vendors & Purchasing", live: false },
];
