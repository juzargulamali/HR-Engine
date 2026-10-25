/**
 * Sample data for the Projects & Tasks redesign concept. EVERYTHING here is fictional: invented clients, people and equipment, no sales
 * values, no real stock. It lives in this file only; nothing in the concept reads or writes a database or calls a live action.
 */

/** The concept's fixed "today", so that overdue and "due soon" read the same every time it is opened. */
export const TODAY = "2026-10-26";
export const TZ = "Asia/Dubai";
export const TZ_LABEL = "GST (Dubai, UTC+4)";

export type TeamId = "Programming" | "Content" | "Engineering";
export interface Person { id: string; name: string; role: string; team: TeamId | null }

export const PEOPLE: Person[] = [
  { id: "layla", name: "Layla Haddad", role: "Project Manager", team: null },
  { id: "omar", name: "Omar Rahal", role: "Head of Programming", team: "Programming" },
  { id: "sara", name: "Sara Nasser", role: "Programmer", team: "Programming" },
  { id: "yusuf", name: "Yusuf Karimi", role: "Programmer", team: "Programming" },
  { id: "nadia", name: "Nadia Farouk", role: "Head of Content", team: "Content" },
  { id: "ravi", name: "Ravi Menon", role: "Content designer", team: "Content" },
  { id: "hana", name: "Hana Saleh", role: "Content designer", team: "Content" },
  { id: "karim", name: "Karim Aziz", role: "Head of Engineering", team: "Engineering" },
  { id: "tomasz", name: "Tomasz Nowak", role: "Engineer", team: "Engineering" },
  { id: "mina", name: "Mina Ortiz", role: "Founder", team: null },
];
export const personName = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? "Unassigned";
export const personFirst = (id: string | null) => personName(id).split(" ")[0] ?? "Unassigned";

/** Who the person looking at the concept is pretending to be. It only changes what the sample offers. */
export type PersonaKind = "founder" | "pm" | "head" | "member" | "directory";
export interface Persona { id: string; kind: PersonaKind; label: string; personId: string | null; companies: ("uae" | "ksa")[] }
export const PERSONAS: Persona[] = [
  { id: "pm", kind: "pm", label: "Project Manager (Layla)", personId: "layla", companies: ["uae"] },
  { id: "founder", kind: "founder", label: "Founder (Mina)", personId: "mina", companies: ["uae", "ksa"] },
  { id: "head", kind: "head", label: "Department head (Omar)", personId: "omar", companies: ["uae"] },
  { id: "member", kind: "member", label: "Team member (Sara)", personId: "sara", companies: ["uae"] },
  { id: "directory", kind: "directory", label: "Directory-only colleague", personId: null, companies: ["uae"] },
];

export type Stage = "planning" | "in_progress" | "ready_for_installation" | "on_site" | "on_hold" | "completed";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "planning", label: "Planning" },
  { id: "in_progress", label: "In progress" },
  { id: "ready_for_installation", label: "Ready for installation" },
  { id: "on_site", label: "On site" },
  { id: "on_hold", label: "On hold" },
  { id: "completed", label: "Completed" },
];
export const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)?.label ?? s;

export interface Project {
  id: string; ref: string; name: string; kind: "client" | "internal"; client: string | null; company: "uae" | "ksa"; companyName: string;
  pm: string; stage: Stage; nextMilestone: { title: string; due: string } | null; install: string | null; show: string | null; summary: string;
  /** Short, factual attention notes for projects whose full data is not part of the sample. The hero projects compute theirs. */
  attention?: string[];
}

const UAE = "Enginious Dubai";
const KSA = "Enginious KSA";
export const PROJECTS: Project[] = [
  { id: "aurora", ref: "ENG-P-0007", name: "Aurora Pavilion: interactive LED floor", kind: "client", client: "Northgate Events", company: "uae", companyName: UAE, pm: "layla", stage: "in_progress", nextMilestone: { title: "Storyboard", due: "2026-10-27" }, install: "2026-11-09", show: "2026-11-14", summary: "A touch-reactive LED floor for a three-day pavilion show." },
  { id: "harbour", ref: "ENG-P-0008", name: "Harbour Museum holofan wall", kind: "client", client: "Harbour Museum", company: "uae", companyName: UAE, pm: "layla", stage: "ready_for_installation", nextMilestone: { title: "Installation", due: "2026-11-09" }, install: "2026-11-09", show: "2026-11-20", summary: "Six holofans in one curved wall.", attention: ["Equipment short by 1"] },
  { id: "desert", ref: "ENG-P-0009", name: "Desert Expo kinetic ceiling", kind: "client", client: "Dune Exhibitions", company: "uae", companyName: UAE, pm: "layla", stage: "planning", nextMilestone: { title: "Moodboard", due: "2026-10-30" }, install: "2026-12-02", show: "2026-12-06", summary: "A moving ceiling of 48 motorised panels.", attention: [] },
  { id: "skyline", ref: "ENG-P-0010", name: "Skyline Mall wayfinding totem", kind: "client", client: "Skyline Retail", company: "uae", companyName: UAE, pm: "hamza", stage: "on_site", nextMilestone: { title: "Handover", due: "2026-10-30" }, install: "2026-10-22", show: "2026-10-28", summary: "Three interactive wayfinding totems.", attention: [] },
  { id: "showroom", ref: "INT-2026-0003", name: "Showroom technology development", kind: "internal", client: null, company: "uae", companyName: UAE, pm: "karim", stage: "in_progress", nextMilestone: { title: "Sensor rig v2 test", due: "2026-11-14" }, install: null, show: null, summary: "Ongoing: the demo wall and sensor rig in our own showroom." },
  { id: "lighthouse", ref: "ENG-P-0011", name: "Lighthouse Hotel lobby projection", kind: "client", client: "Lighthouse Hospitality", company: "uae", companyName: UAE, pm: "hamza", stage: "in_progress", nextMilestone: { title: "Storyboard", due: "2026-10-23" }, install: "2026-11-24", show: "2026-11-28", summary: "A projection-mapped lobby wall.", attention: ["Milestone overdue", "1 task to review"] },
  { id: "oasis", ref: "ENG-P-0012", name: "Oasis Gala stage visuals", kind: "client", client: "Oasis Foundation", company: "uae", companyName: UAE, pm: "layla", stage: "on_hold", nextMilestone: null, install: null, show: null, summary: "Paused by the client until a date is confirmed.", attention: ["On hold: review 12 Nov"] },
  { id: "pearl", ref: "ENG-P-0013", name: "Pearl Tower media facade", kind: "client", client: "Pearl Developments", company: "uae", companyName: UAE, pm: "hamza", stage: "planning", nextMilestone: { title: "Site survey report", due: "2026-11-04" }, install: "2027-01-12", show: "2027-01-20", summary: "A facade media layer, survey stage.", attention: [] },
  { id: "rooftop", ref: "ENG-P-0014", name: "Rooftop Festival projection mapping", kind: "client", client: "Rooftop Culture", company: "uae", companyName: UAE, pm: "layla", stage: "ready_for_installation", nextMilestone: { title: "Full test", due: "2026-11-06" }, install: "2026-11-12", show: "2026-11-16", summary: "Projection mapping on two buildings.", attention: ["1 task blocked"] },
  { id: "souq", ref: "ENG-P-0015", name: "Souq Digital interactive map", kind: "client", client: "Souq Digital", company: "uae", companyName: UAE, pm: "hamza", stage: "in_progress", nextMilestone: { title: "Content freeze", due: "2026-11-10" }, install: "2026-11-30", show: "2026-12-03", summary: "An interactive table map.", attention: [] },
  { id: "riyadh", ref: "KSA-P-0003", name: "Riyadh Boulevard media wall", kind: "client", client: "Boulevard Group", company: "ksa", companyName: KSA, pm: "hamza", stage: "in_progress", nextMilestone: { title: "Hardware demo", due: "2026-11-08" }, install: "2026-11-22", show: "2026-11-26", summary: "A 24 m media wall.", attention: ["Equipment short by 2"] },
  { id: "gallery", ref: "ENG-P-0004", name: "Gallery Nights light installation", kind: "client", client: "Gallery Nights", company: "uae", companyName: UAE, pm: "layla", stage: "completed", nextMilestone: null, install: "2026-09-02", show: "2026-09-06", summary: "Completed in September.", attention: [] },
];
export const projectById = (id: string) => PROJECTS.find((p) => p.id === id) ?? null;
/** Project managers that are not on the team list above (their projects are listed, their workspaces are summary-only samples). */
export const EXTRA_PEOPLE: Record<string, string> = { hamza: "Hamza Idris" };
export const pmName = (id: string) => (EXTRA_PEOPLE[id] ?? personName(id));

export type TaskStatus = "todo" | "doing" | "review" | "done";
export const TASK_STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "In progress" },
  { id: "review", label: "In review" },
  { id: "done", label: "Done" },
];
export interface ChecklistItem { id: string; text: string; done: boolean }
export interface ActivityItem { id: string; who: string; at: string; text: string; kind: "comment" | "event" }
export interface Task {
  id: string; projectId: string; title: string; description: string; assignee: string | null; status: TaskStatus; due: string; milestoneId: string | null;
  team: TeamId; needsReview: boolean; submittedBy?: string; blocked: { reason: string; unblocker: string; since: string } | null; tag?: "client feedback";
  checklist: ChecklistItem[]; activity: ActivityItem[]; createdLocally?: boolean;
}

const ck = (...items: [string, boolean][]) => items.map(([text, done], i) => ({ id: `c${i}`, text, done }));
const ev = (who: string, at: string, text: string, kind: ActivityItem["kind"] = "event"): ActivityItem => ({ id: `${who}-${at}-${text.slice(0, 8)}`, who, at, text, kind });

export const TASKS: Task[] = [
  { id: "t1", projectId: "aurora", title: "Moodboard v2 for the LED floor", description: "Mood, colour and motion references the client approved on 6 October.", assignee: "ravi", status: "done", due: "2026-10-05", milestoneId: "m1", team: "Content", needsReview: true, submittedBy: "ravi", blocked: null, checklist: ck(["Collect references", true], ["Colour palette", true]), activity: [ev("nadia", "5 Oct", "Accepted", "event")] },
  { id: "t2", projectId: "aurora", title: "Storyboard revisions", description: "Scenes 1 to 3 as stills with timing notes. Waiting for a content review before it goes to the client.", assignee: "hana", status: "review", due: "2026-10-26", milestoneId: "m2", team: "Content", needsReview: true, submittedBy: "hana", blocked: null, checklist: ck(["Scene 1 stills", true], ["Scene 2 stills", true], ["Scene 3 stills", true], ["Timing notes", true]), activity: [ev("hana", "12 min ago", "Submitted storyboard", "event"), ev("hana", "Fri 23 Oct", "All four checklist items are done. Ready when you are.", "comment")] },
  { id: "t3", projectId: "aurora", title: "Final render: scenes 1 and 2", description: "Render at 4K in the agreed colour profile.", assignee: "hana", status: "doing", due: "2026-10-29", milestoneId: "m4", team: "Content", needsReview: true, blocked: null, checklist: ck(["Scene 1 render", true], ["Scene 2 render", false], ["Colour check on the floor mock-up", false]), activity: [ev("hana", "Mon 26 Oct", "Started scene 2", "event")] },
  { id: "t4", projectId: "aurora", title: "Final render: scene 3", description: "Needs an owner. Scene 3 is the longest and uses the particle effect.", assignee: null, status: "todo", due: "2026-10-29", milestoneId: "m4", team: "Content", needsReview: true, blocked: null, checklist: [], activity: [] },
  { id: "t5", projectId: "aurora", title: "Touch-floor interaction", description: "Map each tile's pressure input to the scene engine.", assignee: "sara", status: "doing", due: "2026-10-28", milestoneId: "m5", team: "Programming", needsReview: false, blocked: null, checklist: ck(["Tile input mapping", true], ["Scene triggers", false], ["Latency check under 80 ms", false]), activity: [ev("sara", "Sun 25 Oct", "Latency is 120 ms. Working on it.", "comment"), ev("sara", "35 min ago", "Updated interaction logic", "event"), ev("layla", "Sun 25 Oct", "Please keep the client demo in mind: Saturday.", "comment")] },
  { id: "t6", projectId: "aurora", title: "Scene switching API", description: "A small interface so the show controller can switch scenes.", assignee: "sara", status: "todo", due: "2026-10-30", milestoneId: "m5", team: "Programming", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "t13", projectId: "aurora", title: "Unit tests for the scene API", description: "", assignee: "sara", status: "todo", due: "2026-10-30", milestoneId: "m5", team: "Programming", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "t7", projectId: "aurora", title: "Motor controller firmware", description: "Flash and calibrate the six motor controllers.", assignee: "tomasz", status: "todo", due: "2026-10-28", milestoneId: "m6", team: "Engineering", needsReview: false, blocked: { reason: "Two of the six motor controllers have not arrived.", unblocker: "karim", since: "Fri 23 Oct" }, checklist: ck(["Flash controllers 1 to 4", false], ["Flash controllers 5 and 6", false]), activity: [ev("tomasz", "Fri 23 Oct", "Blocked: only four controllers on the shelf", "event")] },
  { id: "t8", projectId: "aurora", title: "Sensor and cable layout", description: "Final drawing for the installation crew.", assignee: "karim", status: "doing", due: "2026-10-30", milestoneId: "m6", team: "Engineering", needsReview: false, blocked: null, checklist: ck(["Frame", true], ["Cable runs", false]), activity: [ev("karim", "1 h ago", "Confirmed cable list", "event")] },
  { id: "t9", projectId: "aurora", title: "Sending card configuration", description: "", assignee: "tomasz", status: "todo", due: "2026-11-01", milestoneId: "m6", team: "Engineering", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "t10", projectId: "aurora", title: "Full-system test script", description: "One script the whole team runs on 5 November.", assignee: "sara", status: "review", due: "2026-11-05", milestoneId: "m7", team: "Programming", needsReview: true, submittedBy: "sara", blocked: null, checklist: [], activity: [] },
  { id: "t11", projectId: "aurora", title: "Installation checklist for the crew", description: "", assignee: "ravi", status: "review", due: "2026-11-06", milestoneId: "m8", team: "Content", needsReview: true, submittedBy: "ravi", blocked: null, checklist: [], activity: [] },
  { id: "t12", projectId: "aurora", title: "Client feedback: brighten scene 2", description: "The client asked for scene 2 to read brighter in daylight. Raised in the discussion on 25 October.", assignee: "hana", status: "todo", due: "2026-10-30", milestoneId: "m4", team: "Content", needsReview: true, blocked: null, tag: "client feedback", checklist: [], activity: [ev("layla", "Sun 25 Oct", "Logged from the client's message", "event")] },
  // Internal project
  { id: "s1", projectId: "showroom", title: "Sensor rig v2 wiring", description: "Rewire the rig for the new sensor board.", assignee: "tomasz", status: "doing", due: "2026-11-07", milestoneId: "sm1", team: "Engineering", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "s2", projectId: "showroom", title: "Demo wall content refresh", description: "", assignee: "hana", status: "todo", due: "2026-11-10", milestoneId: "sm1", team: "Content", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "s3", projectId: "showroom", title: "Gesture demo prototype", description: "", assignee: "yusuf", status: "review", due: "2026-10-30", milestoneId: "sm1", team: "Programming", needsReview: true, submittedBy: "yusuf", blocked: null, checklist: [], activity: [] },
  // Light samples for other projects
  { id: "h1", projectId: "harbour", title: "Holofan wall mounting plan", description: "", assignee: "karim", status: "doing", due: "2026-11-03", milestoneId: null, team: "Engineering", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "h2", projectId: "harbour", title: "Holofan content loop", description: "", assignee: "ravi", status: "todo", due: "2026-11-05", milestoneId: null, team: "Content", needsReview: false, blocked: null, checklist: [], activity: [] },
  { id: "d1", projectId: "desert", title: "Kinetic ceiling moodboard", description: "", assignee: "ravi", status: "doing", due: "2026-10-30", milestoneId: null, team: "Content", needsReview: false, blocked: null, checklist: [], activity: [] },
];
export const tasksOf = (projectId: string) => TASKS.filter((t) => t.projectId === projectId);

export interface TimelineItem {
  id: string; projectId: string; title: string; kind: "milestone" | "deliverable" | "site";
  /** Deadlines are dates (no time zone, never shifted). Site bookings are timed, in the site's zone. */
  date: string; end?: string; startTime?: string; endTime?: string; tz?: string;
  clientFacing: boolean; done: boolean; owner: string; note: string;
  /** Sample crew size for a site booking. */
  people?: number;
}
export const TIMELINE: TimelineItem[] = [
  { id: "m1", projectId: "aurora", title: "Moodboard", kind: "deliverable", date: "2026-10-05", clientFacing: true, done: true, owner: "Content", note: "Approved by the client on 6 October." },
  { id: "m2", projectId: "aurora", title: "Storyboard", kind: "deliverable", date: "2026-10-27", clientFacing: true, done: false, owner: "Content", note: "Version 2 is waiting for an internal review before it goes to the client." },
  { id: "m3", projectId: "aurora", title: "Draft animation", kind: "deliverable", date: "2026-10-19", clientFacing: true, done: true, owner: "Content", note: "Shown to the client on 20 October." },
  { id: "m5", projectId: "aurora", title: "Application demo", kind: "milestone", date: "2026-10-24", clientFacing: true, done: false, owner: "Programming", note: "Two days overdue: interaction latency is still 120 ms. Moving this date does not move the tasks that depend on it; a person decides each one." },
  { id: "m4", projectId: "aurora", title: "Final render", kind: "deliverable", date: "2026-10-28", clientFacing: true, done: false, owner: "Content", note: "Scenes 1 and 2 are in progress. Scene 3 has no owner yet." },
  { id: "m6", projectId: "aurora", title: "Hardware demo", kind: "milestone", date: "2026-11-02", clientFacing: false, owner: "Engineering", done: false, note: "Internal check of the frame, controllers and sending cards. At risk: two motor controllers are short." },
  { id: "m7", projectId: "aurora", title: "Full test", kind: "milestone", date: "2026-11-05", clientFacing: false, done: false, owner: "Programming", note: "The whole team runs the test script." },
  { id: "sb1", projectId: "aurora", title: "Installation & testing", kind: "site", date: "2026-11-09", end: "2026-11-09", startTime: "08:00", endTime: "18:00", tz: TZ, clientFacing: false, done: false, owner: "Engineering", people: 4, note: "Expo Hall 3. Karim Aziz, Tomasz Nowak and two colleagues. Travel 60 min each way and preparation 60 min are protected." },
  { id: "m8", projectId: "aurora", title: "Installation complete", kind: "milestone", date: "2026-11-12", clientFacing: true, done: false, owner: "Engineering", note: "Client walk-through at the end of the day." },
  { id: "sb3", projectId: "aurora", title: "Show crew", kind: "site", date: "2026-11-14", end: "2026-11-14", startTime: "07:00", endTime: "23:00", tz: TZ, clientFacing: false, done: false, owner: "Engineering", note: "Show day. Crew on call all day." },
  { id: "m9", projectId: "aurora", title: "Handover", kind: "milestone", date: "2026-11-16", clientFacing: true, done: false, owner: "Project Manager", note: "Signed handover with the client's contact." },
  { id: "sm1", projectId: "showroom", title: "Sensor rig v2 test", kind: "milestone", date: "2026-11-14", clientFacing: false, done: false, owner: "Engineering", note: "Ongoing internal work. No install or show dates." },
];
export const timelineOf = (projectId: string) => TIMELINE.filter((t) => t.projectId === projectId);

/** A booking on ANOTHER project that genuinely overlaps with Aurora's installation (a physical clash, allowances included). */
export const OTHER_BOOKING = { project: "Harbour Museum holofan wall", person: "tomasz", date: "2026-11-09", startTime: "16:00", endTime: "20:00", tz: TZ };

export interface Message { id: string; projectId: string; who: string; at: string; text: string; replyTo?: string; taskId?: string }
export const MESSAGES: Message[] = [
  { id: "g1", projectId: "aurora", who: "layla", at: "Thu 22 Oct, 10:12", text: "Reminder: the application demo is on Saturday. @sara how is the touch latency?" },
  { id: "g2", projectId: "aurora", who: "sara", at: "Thu 22 Oct, 10:40", text: "Still at 120 ms. I will have a fix on Sunday.", replyTo: "g1", taskId: "t5" },
  { id: "g3", projectId: "aurora", who: "tomasz", at: "Fri 23 Oct, 15:05", text: "Only four of the six motor controllers arrived. I cannot flash the last two. @karim", taskId: "t7" },
  { id: "g4", projectId: "aurora", who: "karim", at: "Fri 23 Oct, 15:30", text: "Understood. @layla this needs a buy-or-rent decision on two units.", replyTo: "g3" },
  { id: "g5", projectId: "aurora", who: "layla", at: "Sun 25 Oct, 18:20", text: "The client says scene 2 looks dim in daylight. I have logged it as a task for @hana.", taskId: "t12" },
  { id: "g6", projectId: "showroom", who: "karim", at: "Mon 26 Oct, 09:00", text: "Rig v2 wiring starts today. @tomasz please post photos in here." },
];
export const messagesOf = (projectId: string) => MESSAGES.filter((m) => m.projectId === projectId);

export type EqStage = "requested" | "reserved" | "dispatched" | "returned";
export interface EquipmentLine { id: string; projectId: string; item: string; requested: number; reserved: number; dispatched: number; returned: number; dueBack?: string; shortNote?: string; draft?: boolean }
export const EQUIPMENT: EquipmentLine[] = [
  { id: "e1", projectId: "aurora", item: "LED floor tile 50 × 50 cm", requested: 24, reserved: 24, dispatched: 0, returned: 0 },
  { id: "e2", projectId: "aurora", item: "Sending card", requested: 4, reserved: 4, dispatched: 0, returned: 0 },
  { id: "e3", projectId: "aurora", item: "Motor controller", requested: 6, reserved: 4, dispatched: 0, returned: 0, shortNote: "Short by 2. Needs a buy-or-rent decision by Layla Haddad." },
  { id: "e4", projectId: "aurora", item: "Laptop, programming", requested: 2, reserved: 2, dispatched: 2, returned: 0, dueBack: "2026-11-17" },
  { id: "e5", projectId: "harbour", item: "Holofan 75 cm", requested: 6, reserved: 5, dispatched: 0, returned: 0, shortNote: "Short by 1." },
];
export const equipmentOf = (projectId: string) => EQUIPMENT.filter((e) => e.projectId === projectId);
export const REQUEST_CODE: Record<string, string> = { aurora: "ENG-R-00012", harbour: "ENG-R-00013" };

export const SAMPLE_ITEMS = ["LED floor tile 50 × 50 cm", "Sending card", "Motor controller", "Laptop, programming", "Holofan 75 cm", "Projector 12k lumen"];

// Dates are formatted by hand, not with Intl: the server and the browser can disagree on punctuation ("Mon 2 Nov" or "Mon, 2 Nov"),
// which would make the page fail to hydrate cleanly.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return { wd: DAYS[d.getUTCDay()]!, d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()]!, y: d.getUTCFullYear() }; };
export const fmtDay = (iso: string) => { const p = parts(iso); return `${p.wd} ${p.d} ${p.m}`; };
export const fmtDate = (iso: string) => { const p = parts(iso); return `${p.d} ${p.m} ${p.y}`; };
export const fmtShort = (iso: string) => { const p = parts(iso); return `${p.d} ${p.m}`; };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
