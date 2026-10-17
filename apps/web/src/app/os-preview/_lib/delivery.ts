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
];

export const WEEK_DAYS = ["Mon 19", "Tue 20", "Wed 21", "Thu 22", "Fri 23"] as const;
/** Programming team plan for the sample week. `null` = unassigned. Two-project days are the competing-deadline signal. */
export const TEAM_PLAN: { person: string; days: (string[] | null)[] }[] = [
  { person: "Nadia Farouk", days: [["Expo stand"], ["Expo stand", "Bank lobby"], ["Expo stand", "Bank lobby"], ["Bank lobby"], null] },
  { person: "Ibrahim Saad", days: [["Bank lobby"], ["Bank lobby"], ["Bank lobby", "Marina"], ["Bank lobby"], ["Marina"]] },
  { person: "Zeynep Arslan", days: [["Marina"], ["Marina"], null, ["Expo stand"], ["Expo stand", "Marina"]] },
];

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
